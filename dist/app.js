// Op Music DS - Local music player (Rust + Tauri)
// Serif - Monochrome - Borderless
(function(){
'use strict';
var invoke = window.__TAURI__ ? window.__TAURI__.core.invoke : null;
var convertFileSrc = (function(){
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc)
    return window.__TAURI__.core.convertFileSrc;
  // Fallback: some Tauri v2 builds expose it differently
  if (window.__TAURI__ && window.__TAURI__.convertFileSrc)
    return window.__TAURI__.convertFileSrc;
  // Fallback: manual URL construction
  return function(filePath){
    return 'https://asset.localhost/' + encodeURIComponent(filePath.replace(/\\/g, '/'));
  };
})();
if (!invoke) {
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Georgia,serif;font-size:18px;color:#1c1917;background:#fafaf9;text-align:center;padding:40px;"><div><h1 style="font-size:48px;margin-bottom:16px;">♪</h1><p>Op Music requires the Tauri runtime.</p><p style="font-size:14px;color:#a8a29e;margin-top:8px;">Run via <code>cargo run</code> from src-tauri.</p></div></div>';
  throw new Error('Tauri API not available');
}
var $ = function(id){ return document.getElementById(id); };
var EMOJI = [];
(function(){
  for(var c=0x1F32D; c<=0x1F37F; c++) EMOJI.push(String.fromCodePoint(c));
  for(var c=0x1F950; c<=0x1F96F; c++) EMOJI.push(String.fromCodePoint(c));
})();
function remoji(seed){ return EMOJI[Math.abs(seed) % EMOJI.length]; }
function fmt(s){ if(!s||isNaN(s)) return '0:00'; return Math.floor(s/60)+':'+(Math.floor(s%60)<10?'0':'')+Math.floor(s%60); }
var cur=null, queue=[], idx=-1, playing=false, vol=0.7, prog=0, dur=0, poff=0, usingAudio=false;
var _playGen=0, _progGen=0, loved=[], allPls=[], currentPlId='all';
var specVals=null, specRAF=null, analyser=null, actx=null, specData=null, _specColors=null;
var SPEC_N=32;
// Favorites: stored as file paths on disk via Rust, auto-cleaned of stale files
// Normalize path for comparison: lowercase + forward slashes (Windows is case-insensitive)
function normPath(p){ return (p||'').replace(/\\/g,'/').toLowerCase(); }
function lovedHas(p){ return loved.some(function(x){ return normPath(x)===normPath(p); }); }

function saveLoved(){
  invoke('save_favorites',{paths:loved}).catch(function(e){ console.warn('save_favorites failed:',e); });
}
function loadLoved(){
  return invoke('load_favorites').then(function(paths){
    loved = paths || [];
  }).catch(function(e){
    console.warn('load_favorites failed:', e);
    loved = [];
  });
}
var audio = $('audioPlayer');
function cmdAddScanDir(dir){ return invoke('add_scan_dir',{dir:dir}); }
function cmdRemoveScanDir(dir){ return invoke('remove_scan_dir',{dir:dir}); }
function cmdScanAll(){ return invoke('scan_all_dirs'); }
function cmdLibrary(){ return invoke('get_library',{}); }
function cmdPlaylist(id){ return invoke('get_playlist',{playlistId:id}); }
function cmdSearch(kw){ return invoke('search_library',{keyword:kw}); }
function cmdScanDirs(){ return invoke('get_scan_dirs',{}); }
function cmdStats(){ return invoke('get_library_stats',{}); }

// ---- Playback ----
function updateLikeBtn(){
  var btn=$('likeBtn'); if(btn) btn.classList.toggle('liked', cur && lovedHas(cur.path));
}
function updateSpectrumInfo(){
  if(!cur) return;
  // Sync cover from player bar
  var npBg = $('nowPlayingArt').style.backgroundImage;
  if(npBg){
    $('spectrumArt').style.backgroundImage = npBg;
    $('spectrumArt').style.backgroundSize = 'cover';
    $('spectrumArt').textContent = '';
  } else {
    $('spectrumArt').style.backgroundImage = '';
    $('spectrumArt').textContent = remoji(cur.id);
  }
  $('spectrumTitle').textContent = cur.title;
  $('spectrumArtist').textContent = cur.artist||'';
}

function playSong(s){
  if(!s) return;
  if(cur && cur.id===s.id && playing) return;
  cur=s; idx=-1;
  for(var i=0;i<queue.length;i++) if(queue[i].id===s.id){ idx=i; break; }
  dur = s.duration||240; prog=0; poff=0;
  $('nowPlayingTitle').textContent = s.title;
  $('nowPlayingArtist').textContent = s.artist||'Unknown';
  $('nowPlayingInitials').textContent = remoji(s.id);
  $('totalTime').textContent = fmt(dur);
  $('currentTime').textContent = '0:00';
  $('progressFill').style.width = '0%';
  var rows = document.querySelectorAll('.song-row');
  for(var r=0;r<rows.length;r++) rows[r].classList.toggle('playing', Number(rows[r].dataset.id)===s.id);
  usingAudio = false;
  if(audio){ audio.pause(); try{audio.removeAttribute('src');audio.load();}catch(e){} }
  playing=true; $('playIcon').style.display='none'; $('pauseIcon').style.display='block';
  $('nowPlayingArt').classList.add('playing');
  var myGen = ++_playGen;
  updateLikeBtn();
  updateSpectrumInfo();
  // Pre-generate spectrum colors once per song (avoids flicker with Rdm)
  var colors=getLyricsColors();
  _specColors=[];
  for(var si=0;si<SPEC_N;si++){
    if(colors.length===1 && colors[0]==='__RANDOM__'){
      _specColors.push('#'+Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0'));
    } else {
      _specColors.push(colors[si%colors.length]);
    }
  }
  // Load embedded cover art
  $('nowPlayingArt').style.backgroundImage = '';
  $('nowPlayingInitials').style.display = '';
  invoke('read_cover_art',{path:s.path}).then(function(dataUrl){
    if(!cur || cur.id!==s.id) return;
    if(dataUrl){
      $('nowPlayingArt').style.backgroundImage = 'url('+dataUrl+')';
      $('nowPlayingArt').style.backgroundSize = 'cover';
      $('nowPlayingInitials').style.display = 'none';
      // Also update spectrum art if open
      if($('spectrumOverlay').classList.contains('active')){
        $('spectrumArt').style.backgroundImage = 'url('+dataUrl+')';
        $('spectrumArt').style.backgroundSize = 'cover';
        $('spectrumArt').textContent = '';
      }
    }
  }).catch(function(){});

  // Load via Rust base64 data URL — same pattern as original fetch()
  console.log('Loading audio:', s.path);
  var spinnerFrames=['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧'];
  var spinnerIdx=0, spinnerEl=$('nowPlayingTitle');
  spinnerEl.textContent = s.title + ' ⠋';
  var spinnerId=setInterval(function(){
    spinnerIdx=(spinnerIdx+1)%spinnerFrames.length;
    if(spinnerEl) spinnerEl.textContent = s.title + ' ' + spinnerFrames[spinnerIdx];
  }, 80);

  invoke('read_audio_data_url', { path: s.path }).then(function(dataUrl){
    if(!cur||cur.id!==s.id) return;
    clearInterval(spinnerId);
    console.log('Data URL received, length:', dataUrl.length);
    audio.src = dataUrl;
    audio.volume = vol;
    usingAudio = true;
    _progGen = myGen;
    ensureAnalyser();
    if(actx && actx.state==='suspended') actx.resume();
    return audio.play();
  }).then(function(){
    if(!cur || cur.id!==s.id) return;
    clearInterval(spinnerId);
    console.log('Playback started:', cur.title);
    $('nowPlayingTitle').textContent = cur.title;
  }).catch(function(e){
    clearInterval(spinnerId);
    console.warn('Play failed:', e && e.message);
    if(!cur || cur.id!==s.id) return;
    usingAudio = false;
    $('nowPlayingTitle').textContent = cur.title + ' ❌';
  });
}
var pT=null;
var _progressRAF=null;
function progressLoop(){
  if(!playing||!cur||_progGen!==_playGen){ _progressRAF=null; return; }
  _progressRAF=requestAnimationFrame(progressLoop);
  prog=audio.currentTime;
  if(audio.duration&&!isNaN(audio.duration)) dur=audio.duration;
  poff=prog;
  var p=dur?(prog/dur)*100:0;
  $('progressFill').style.width=p+'%';
  $('currentTime').textContent=fmt(prog);
}
function startProgressLoop(){ if(!_progressRAF){ _progressRAF=requestAnimationFrame(progressLoop); } }
function stopProgressLoop(){ if(_progressRAF){ cancelAnimationFrame(_progressRAF); _progressRAF=null; } }
function startProg(){
  stopProg();
  if(usingAudio) return;
  var t0=Date.now();
  (function tick(){
    if(!playing||!cur) return;
    var e=poff+(Date.now()-t0)/1000;
    if(e>=dur){ endSong(); return; }
    prog=e;
    var p=dur?(prog/dur)*100:0;
    $('progressFill').style.width=p+'%';
    $('currentTime').textContent=fmt(prog);
    pT=requestAnimationFrame(tick);
  })();
}
function stopProg(){ if(pT){ cancelAnimationFrame(pT); pT=null; } stopProgressLoop(); }
function ensureAnalyser(){
  if(analyser) return;
  try{
    actx = new (window.AudioContext||window.webkitAudioContext)();
    var src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    src.connect(analyser);
    analyser.connect(actx.destination);
    specData = new Uint8Array(analyser.frequencyBinCount);
  }catch(e){ analyser=null; actx=null; }
}

function togglePlay(){
  if(!cur){ if(queue.length) playSong(queue[0]); return; }
  if(playing){
    playing=false; stopProg(); poff=prog;
    var a=audio; if(a) a.pause();
    $('playIcon').style.display='block'; $('pauseIcon').style.display='none';
    $('nowPlayingArt').classList.remove('playing');
  } else {
    playing=true;
    var a=audio;
    if(usingAudio && a && a.src){
      a.play().catch(function(){ usingAudio=false; });
    }
    startProg();
    $('playIcon').style.display='none'; $('pauseIcon').style.display='block';
    $('nowPlayingArt').classList.add('playing');
  }
}
function nextTrack(){ if(!queue.length) return; playSong(queue[(idx+1)%queue.length]); }
function prevTrack(){
  if(!queue.length) return;
  if(prog>3){ if(usingAudio && audio && audio.src){ audio.currentTime=0; } else if(cur){ poff=prog=0; startProg(); } return; }
  playSong(queue[(idx-1+queue.length)%queue.length]);
}
function endSong(){
  stopProg();
  if(idx<queue.length-1) nextTrack();
  else { playing=false; $('playIcon').style.display='block'; $('pauseIcon').style.display='none'; $('nowPlayingArt').classList.remove('playing'); }
}

function seekProg(e){
  if(!dur) return;
  var r=$('progressBar').getBoundingClientRect();
  var p=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
  poff=prog=p*dur;
  if(usingAudio && audio && audio.src) audio.currentTime=prog;
  var pct=p*100;
  $('progressFill').style.width=pct+'%';
  $('currentTime').textContent=fmt(prog);
}
function seekVol(e){
  var r=$('volumeBar').getBoundingClientRect();
  vol=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
  $('volumeFill').style.width=(vol*100)+'%';
  if(audio) audio.volume=vol;
}

// ---- Spectrum ----
function fakeSpec(t){
  var a=[], bpm=128, beat=(t*bpm/60)%1;
  var kick=Math.exp(-beat*10)*0.8, snare=Math.exp(-((beat+0.5)%1)*12)*0.5;
  var hihat=((beat*4)%1<0.15)?Math.random()*0.3:0;
  for(var i=0;i<SPEC_N;i++){
    var x=i/SPEC_N;
    var low=kick*Math.exp(-x*6)*(x<0.18?1:0.15);
    var bass=Math.exp(-Math.pow((x-0.12)*8,2))*kick*0.5;
    var mel=Math.sin(t*4.7+i*0.5)*0.12+Math.sin(t*2.3+i*0.23)*0.08+Math.random()*0.06;
    var mid=(0.22+mel)*Math.exp(-Math.pow((x-0.32)*3.5,2));
    var harm=Math.sin(t*6.1+i*1.1)*0.08*Math.exp(-Math.pow((x-0.5)*4,2));
    var hi=(snare+hihat)*Math.random()*0.4*(x>0.55?1:0.05);
    var env=Math.exp(-x*1.8)*0.15;
    a.push(Math.max(0,Math.min(1,low+bass+mid+harm+hi+env)));
  }
  return a;
}
function openSpectrum(){
  if(!cur) return;
  updateSpectrumInfo();
  $('spectrumOverlay').classList.add('active');
  if(actx && actx.state==='suspended') actx.resume();
  if(!specRAF) specLoop();
}
function closeSpectrum(){ $('spectrumOverlay').classList.remove('active'); }

// ---- Lyrics word-cloud ----
var _lyricsEntries=[], _lyricsChars=[], _lyricsRevealed=0, _lyricsRAF=null;
var _lyricsLastLine=-1, _lyricsScheme='4', _lyricsInterval=0.3;
var _lyricsPlaced=[];       // placed bounding boxes, persistent across frames
var _lyricsOffCtx=null;     // 2D context for offscreen accumulation canvas
var _lyricsOffW=0, _lyricsOffH=0;
var _lyricsFontFam='';      // cached font family
try{ _lyricsScheme=localStorage.getItem('op_ds_lyrics_scheme')||'4'; }catch(e){}
$('lyricsColorScheme').value = _lyricsScheme;

function getLyricsColors(){
  var scheme = _lyricsScheme || '4';
  if(scheme==='1') return ['#74d7ee','#ffafc8'];
  if(scheme==='2') return ['#8cbfb0','#eea837','#9b2d25','#8b8e8d'];
  if(scheme==='3') return ['#ff00f0','#fffa00','#00ffa2'];
  if(scheme==='5') return ['__RANDOM__']; // per-word random
  // Scheme 4 (default): pure black on light, pure white on blue
  var bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if(bg==='#2f55cb') return ['#ffffff'];
  return ['#1c1917'];
}

// Word tokenizer: spaces for Latin, Intl.Segmenter for CJK, regex fallback
var _segmenter=null;
try{ _segmenter=new Intl.Segmenter('zh-CN',{granularity:'word'}); }catch(e){}
function tokenizeWords(text){
  if(!text) return [];
  // If Intl.Segmenter is available, use it for proper word segmentation
  if(_segmenter){
    var words=[];
    var seg=_segmenter.segment(text);
    for(var it=seg[Symbol.iterator](), r=it.next(); !r.done; r=it.next()){
      var w=r.value.segment.trim();
      if(w && !/^[\s,，。！？、；：""''（）\(\)\[\]【】…—\-·\.]+$/.test(w)) words.push(w);
    }
    if(words.length>0) return words;
  }
  // Fallback: split by spaces, then handle CJK runs
  var result=[];
  var parts=text.split(/([一-鿿㐀-䶿豈-﫿぀-ゟ゠-ヿ가-힯]+)/);
  for(var i=0;i<parts.length;i++){
    if(!parts[i]) continue;
    if(/^[一-鿿㐀-䶿豈-﫿぀-ゟ゠-ヿ가-힯]+$/.test(parts[i])){
      // CJK: split into 1~3 char chunks (simple jieba-like approach)
      var run=parts[i];
      var pos=0;
      while(pos<run.length){
        var len=run.length-pos>=3?2+Math.floor(Math.random()*2):run.length-pos;
        len=Math.min(len,run.length-pos);
        result.push(run.substring(pos,pos+len));
        pos+=len;
      }
    } else {
      // Latin: split by spaces
      var tokens=parts[i].split(/\s+/).filter(function(t){ return t.trim(); });
      for(var j=0;j<tokens.length;j++) result.push(tokens[j]);
    }
  }
  return result;
}

// Clean a single lyric line: remove punctuation, translations, metadata headers
function cleanLyricLine(raw, songTitle){
  var txt=raw.trim();
  if(!txt) return '';
  // Remove translations after " / " or enclosed in （）()【】[]
  txt=txt.replace(/\s*\/\s*.+$/,'');
  // Labeled translations: xxx (翻译：yyy)  xxx（译：yyy） xxx (中译：yyy)
  txt=txt.replace(/[（(]\s*(?:中?译|翻译|英文?|日文?|韩文?|中文?|原曲|原词|cover|ver|feat|prod|remix)\s*[：:]\s*[^)）]*[)）]/gi,'');
  // Any remaining parenthetical content (bare translations)
  txt=txt.replace(/[（(][^)）]*[)）]/g,'');
  txt=txt.replace(/[【\[]{1}[^\]】]*[\]】]{1}/g,'');
  txt=txt.trim();
  if(!txt) return '';
  // Replace metadata headers (作词/作曲/编曲/混音/母带/制作/和声 etc) with song title
  if(/^作词|^作曲|^编曲|^混音|^母带|^制作人|^制作|^和声|^录音|^监制|^吉他|^贝斯|^键盘|^鼓|^弦乐|^词|^曲|^编|^混|^录|^和声编写|^配唱|^出品|^发行|^厂牌|^艺人|^专辑/.test(txt)){
    return songTitle||txt;
  }
  return txt;
}

// Parse LRC timestamps: [mm:ss.xx]text → [{time:sec, text:string}]
function parseLRC(text, songTitle){
  if(!text) return [];
  var entries=[];
  var lines=text.split(/\n/);
  for(var i=0;i<lines.length;i++){
    var match=lines[i].match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
    if(match){
      var min=parseInt(match[1]), sec=parseFloat(match[2]);
      var txt=cleanLyricLine(match[3], songTitle);
      if(txt.length>0) entries.push({time:min*60+sec, text:txt});
    }
  }
  // Merge duplicate times (multiple timestamps on one line produce separate entries)
  entries.sort(function(a,b){ return a.time-b.time; });
  return entries;
}

function openLyrics(){
  if(!cur) return;
  $('lyricsOverlay').classList.add('active');
  $('lyricsEmpty').classList.remove('show');
  $('lyricsCanvas').style.display='block';
  invoke('read_lyrics',{path:cur.path}).then(function(text){
    _lyricsEntries=parseLRC(text, cur?cur.title:'');
    _lyricsLastLine=-1;
    _lyricsRevealed=0;
    _lyricsChars=[];
    renderLyricsWordCloud([]);
    if(!_lyricsRAF) lyricsSyncLoop();
    if(_lyricsEntries.length===0) showLyricsEmpty();
  }).catch(function(e){
    console.warn('read_lyrics failed:',e);
    showLyricsEmpty();
  });
}

function showLyricsEmpty(){
  $('lyricsCanvas').style.display='none';
  $('lyricsEmpty').classList.add('show');
}

function lyricsSyncLoop(){
  if(!$('lyricsOverlay').classList.contains('active')){ _lyricsRAF=null; return; }
  _lyricsRAF=requestAnimationFrame(lyricsSyncLoop);
  if(!cur||!playing) return;
  var t=audio.currentTime;
  var lineIdx=-1;
  for(var i=0;i<_lyricsEntries.length;i++){
    if(_lyricsEntries[i].time<=t) lineIdx=i; else break;
  }
  if(lineIdx>=0 && lineIdx!==_lyricsLastLine){
    // New line: reset everything
    _lyricsLastLine=lineIdx;
    _lyricsRevealed=0;
    _lyricsPlaced=[];
    var txt=_lyricsEntries[lineIdx].text;
    _lyricsChars=tokenizeWords(txt);
    var lineStart=_lyricsEntries[lineIdx].time;
    var lineEnd=(lineIdx+1<_lyricsEntries.length)?_lyricsEntries[lineIdx+1].time:lineStart+4;
    _lyricsInterval=(lineEnd-lineStart)*0.7/Math.max(_lyricsChars.length,1);
    // Clear both canvases for new line (use pixel dimensions)
    if(_lyricsOffCtx){
      _lyricsOffCtx.setTransform(1,0,0,1,0,0);
      _lyricsOffCtx.clearRect(0,0,_lyricsOffCtx.canvas.width,_lyricsOffCtx.canvas.height);
    }
    var cv=$('lyricsCanvas');
    if(cv){ var ctx=cv.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,cv.width,cv.height); }
  }
  if(_lyricsChars.length>0 && _lyricsLastLine>=0 && _lyricsInterval>0){
    var lineStart=_lyricsEntries[_lyricsLastLine].time;
    var target=Math.floor((t-lineStart)/_lyricsInterval);
    if(target>_lyricsRevealed && target<=_lyricsChars.length){
      // New word(s) to reveal — only draw the newly revealed ones
      var newWords=[];
      for(var v=_lyricsRevealed; v<target; v++){
        if(v<_lyricsChars.length) newWords.push(_lyricsChars[v]);
      }
      _lyricsRevealed=target;
      renderLyricsWordCloud(newWords, false);
    }
  }
}

function renderLyricsWordCloud(words, clear){
  var cv=$('lyricsCanvas');
  if(!cv) return;
  var w=cv.parentElement.clientWidth, h=cv.parentElement.clientHeight;
  if(!w||!h) return;
  var dpr=window.devicePixelRatio||1;
  cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
  cv.style.width=w+'px'; cv.style.height=h+'px';

  // Lazy-init offscreen canvas
  if(!_lyricsOffCtx || _lyricsOffW!==w || _lyricsOffH!==h){
    var off=document.createElement('canvas');
    off.width=Math.round(w*dpr); off.height=Math.round(h*dpr);
    _lyricsOffCtx=off.getContext('2d');
    _lyricsOffW=w; _lyricsOffH=h;
    _lyricsFontFam=getComputedStyle(document.documentElement).getPropertyValue('--font').replace(/"/g,'').trim();
  }

  var octx=_lyricsOffCtx;
  octx.setTransform(dpr,0,0,dpr,0,0);

  if(clear){
    octx.clearRect(0,0,w,h);
    _lyricsPlaced=[];
  }

  var arr=words||[];
  // Handle empty state
  if(clear && arr.length===0){
    octx.setTransform(1,0,0,1,0,0);
    octx.clearRect(0,0,octx.canvas.width,octx.canvas.height);
    octx.setTransform(dpr,0,0,dpr,0,0);
    octx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim();
    octx.font='18px '+_lyricsFontFam;
    octx.textAlign='center';
    octx.fillText('♪',w/2,h/2);
    octx.textAlign='start';
    var ctx=cv.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.drawImage(octx.canvas,0,0);
    return;
  }

  var colors=getLyricsColors();
  var padding=6;

  for(var i=0;i<arr.length;i++){
    var word=arr[i];
    if(!word||!word.trim()) continue;
    var placed=false;

    for(var attempt=0;attempt<200;attempt++){
      var size=18+Math.random()*Math.min(w,h)*0.4;
      size=Math.max(10,Math.min(size,Math.min(w,h)*0.5));
      octx.font='bold '+Math.round(size)+'px '+_lyricsFontFam;
      var m=octx.measureText(word);
      var tw=m.width+padding*2, th=size+padding*2;
      // Safety: skip if word is wider than canvas
      if(tw>=w || th>=h) continue;

      var x=padding+Math.random()*(w-tw-2*padding);
      var y=padding+Math.random()*(h-th-2*padding);
      x=Math.max(padding, Math.min(x, w-tw-padding));
      y=Math.max(padding, Math.min(y, h-th-padding));
      if(x<0||y<0) continue;

      var hit=false;
      for(var jj=0;jj<_lyricsPlaced.length;jj++){
        var r=_lyricsPlaced[jj];
        if(x<r.x+r.w && x+tw>r.x && y<r.y+r.h && y+th>r.y){ hit=true; break; }
      }
      if(!hit){
        var col;
        if(colors.length===1 && colors[0]==='__RANDOM__'){
          col='#'+Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0');
        } else {
          col=colors[Math.floor(Math.random()*colors.length)];
        }
        octx.fillStyle=col;
        var vertical=Math.random()<0.35;
        if(vertical && word.length>=1){
          var charH=size, totalH=word.length*(charH+2);
          if(totalH<h && y+totalH+padding<h){
            for(var ci=0;ci<word.length;ci++){
              octx.fillText(word[ci], x+padding, y+padding+ci*(charH+2)+charH);
            }
            _lyricsPlaced.push({x:x, y:y, w:tw, h:totalH+padding*2});
            placed=true; break;
          }
        }
        // Horizontal (or vertical fallback)
        octx.fillText(word, x+padding, y+th-padding/2);
        _lyricsPlaced.push({x:x, y:y, w:tw, h:th});
        placed=true; break;
      }
    }
    if(!placed){
      // Grid fallback
      for(var gx=padding;gx<w-tw;gx+=Math.ceil(tw*0.65)){
        for(var gy=padding;gy<h-th;gy+=Math.ceil(th*0.65)){
          var h2=false;
          for(var kk=0;kk<_lyricsPlaced.length;kk++){
            var r2=_lyricsPlaced[kk];
            if(gx<r2.x+r2.w && gx+tw>r2.x && gy<r2.y+r2.h && gy+th>r2.y){ h2=true; break; }
          }
          if(!h2){
            var col2;
            if(colors.length===1 && colors[0]==='__RANDOM__'){
              col2='#'+Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0');
            } else {
              col2=colors[Math.floor(Math.random()*colors.length)];
            }
            octx.fillStyle=col2;
            octx.fillText(word, gx+padding, gy+th-padding/2);
            _lyricsPlaced.push({x:gx,y:gy,w:tw,h:th});
            placed=true; break;
          }
        }
        if(placed) break;
      }
    }
  }

  // Copy offscreen to visible canvas
  var ctx=cv.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.drawImage(octx.canvas,0,0);
}

function closeLyrics(){
  $('lyricsOverlay').classList.remove('active');
  _lyricsLastLine=-1;
  _lyricsRevealed=0;
  _lyricsChars=[];
}
function specLoop(){
  if(!$('spectrumOverlay').classList.contains('active')){ specRAF=null; return; }
  specRAF=requestAnimationFrame(specLoop);
  var cv=$('spectrumCanvas'); if(!cv) return;
  var dpr=window.devicePixelRatio||1;
  var w=cv.clientWidth, h=cv.clientHeight;
  if(!w||!h) return;
  if(cv.width!==Math.round(w*dpr)){ cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); }
  var ctx=cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  if(!specVals) specVals = new Float32Array(SPEC_N);
  if(!_specColors){ _specColors=[]; for(var si=0;si<SPEC_N;si++) _specColors.push('#1c1917'); }
  var real = analyser && usingAudio;
  if(real) analyser.getByteFrequencyData(specData);
  var gap=w/SPEC_N, bw=Math.max(2,gap*0.45);
  for(var i=0;i<SPEC_N;i++){
    var t=0;
    if(real){
      var bin=2+Math.floor(Math.pow(i/SPEC_N,1.15)*(specData.length-4)*0.65);
      t=specData[bin]/255;
    }
    specVals[i] += (t-specVals[i])*(t>specVals[i]?0.65:0.22);
    var bh=Math.max(2,specVals[i]*(h-6));
    ctx.fillStyle = _specColors[i] || '#1c1917';
    ctx.fillRect(i*gap+(gap-bw)/2, h-bh, bw, bh);
  }
}

// ---- Song list rendering ----
function renderSongs(pl){
  queue = pl.songs.slice();
  $('heroTitle').textContent = pl.name;
  $('heroDesc').textContent = pl.songs.length + ' 首歌曲';
  var h='';
  for(var i=0;i<pl.songs.length;i++){
    var s=pl.songs[i];
    h+='<li class="song-row" data-id="'+s.id+'" data-index="'+i+'"><span class="song-num">'+(i+1)+'</span><div class="song-title-wrap"><span class="song-title">'+s.title+'</span></div><span class="song-artist">'+(s.artist||'Unknown')+'</span><span class="song-album">'+(s.album||'--')+'</span><span class="song-dur">'+fmt(s.duration)+'</span></li>';
  }
  $('songsList').innerHTML = h;
  var rows = $('songsList').querySelectorAll('.song-row');
  for(var r=0;r<rows.length;r++) (function(x){
    rows[r].addEventListener('click',function(){ playSong(pl.songs[x]); });
  })(r);
}

function switchPlaylist(id){
  if(id==='fav'){ showFavorites(); return; }
  $('exportFavBtn').style.display = 'none';
  var pl = null;
  for(var i=0;i<allPls.length;i++) if(allPls[i].id===id){ pl=allPls[i]; break; }
  if(!pl) return;
  currentPlId = id;
  var items=document.querySelectorAll('.playlist-item');
  for(var k=0;k<items.length;k++) items[k].classList.toggle('active', items[k].dataset.id===''+id);
  renderSongs(pl);
  switchView('discover');
}

function showFavorites(){
  var matched=[], libSongs=[];
  for(var i=0;i<allPls.length;i++) libSongs=libSongs.concat(allPls[i].songs);
  for(var j=0;j<libSongs.length;j++) if(lovedHas(libSongs[j].path)) matched.push(libSongs[j]);
  // dedup by normalized path
  var seen={}, uniq=[];
  for(var k=0;k<matched.length;k++){ var np=normPath(matched[k].path); if(!seen[np]){ seen[np]=true; uniq.push(matched[k]); } }
  var pl={id:'fav',name:'收藏夹',letter:'♥',songs:uniq};
  var items=document.querySelectorAll('.playlist-item');
  for(var m=0;m<items.length;m++) items[m].classList.toggle('active', items[m].dataset.id==='fav');
  currentPlId='fav';
  renderSongs(pl);
  switchView('discover');
  // Show export button only on favorites
  $('exportFavBtn').style.display = '';
}

// ---- View switching ----
function switchView(v){
  var vs=document.querySelectorAll('.view');
  for(var i=0;i<vs.length;i++) vs[i].classList.remove('active');
  var el=document.querySelector('.view-'+v);
  if(el) el.classList.add('active');
  var ns=document.querySelectorAll('.nav-item');
  for(var j=0;j<ns.length;j++) ns[j].classList.toggle('active', ns[j].dataset.view===v);
  if(v==='library') renderLib();
  // Hide discover view if no playlists
  updateOnboarding();
}

function updateOnboarding(){
  var hasSongs = allPls.length > 0;
  var isDiscover = document.querySelector('.view-discover.active');
  // Only show onboarding on the discover/home page when no songs loaded
  $('onboarding').style.display = (!hasSongs && isDiscover) ? 'flex' : 'none';
  var dv = document.querySelector('.view-discover');
  if(dv) dv.style.display = hasSongs ? '' : 'none';
}

// ---- Search ----
function onSearch(v){
  var kw=v.trim();
  if(!kw){ $('searchGrid').innerHTML=''; $('searchEmpty').style.display='block'; $('searchTitle').textContent='搜索本地音乐'; return; }
  $('searchEmpty').style.display='none';
  $('searchTitle').textContent='搜索: '+kw;
  $('searchGrid').innerHTML='<div class="search-card"><div class="search-card-art">搜</div><div class="search-card-title">搜索中...</div></div>';
  cmdSearch(kw).then(function(matched){
    renderSearchCards(matched);
  }).catch(function(e){
    console.warn('Search failed:', e);
    renderSearchCards([]);
  });
}

function renderSearchCards(matched){
  if(!matched.length){
    $('searchGrid').innerHTML='<div class="search-card"><div class="search-card-art">无</div><div class="search-card-title">无结果</div><div class="search-card-artist">试试其他关键词</div></div>';
    return;
  }
  var h='';
  for(var i=0;i<matched.length;i++){
    var s=matched[i];
    h+='<div class="search-card" data-idx="'+i+'"><div class="search-card-art" id="sc-art-'+s.id+'">'+remoji(s.id)+'</div><div class="search-card-title">'+s.title+'</div><div class="search-card-artist">'+(s.artist||'Unknown')+'</div></div>';
  }
  $('searchGrid').innerHTML=h;
  var cs=$('searchGrid').querySelectorAll('.search-card');
  for(var c=0;c<cs.length;c++) (function(x){
    cs[c].addEventListener('click',function(){
      queue=matched.slice();
      renderSongs({id:'search',name:'搜索结果',letter:'搜',songs:matched});
      playSong(matched[x]);
      switchView('discover');
    });
  })(c);
  // Lazy-load cover art for each search result
  for(var ci=0;ci<matched.length;ci++) (function(s){
    invoke('read_cover_art',{path:s.path}).then(function(dataUrl){
      if(!dataUrl) return;
      var el=document.getElementById('sc-art-'+s.id);
      if(el){ el.style.backgroundImage='url('+dataUrl+')'; el.style.backgroundSize='cover'; el.textContent=''; }
    }).catch(function(){});
  })(matched[ci]);
}

// ---- Library view ----
function renderLib(){
  cmdStats().then(function(stats){
    $('statTracks').textContent = stats.total_tracks + ' 首';
    $('statPlaylists').textContent = stats.total_playlists + ' 个';
    $('statLoved').textContent = loved.length + ' 首';
  }).catch(function(){});
  var h='';
  for(var k=0;k<allPls.length;k++){
    var pl=allPls[k];
    h+='<div class="search-card" data-pid="'+pl.id+'"><div class="search-card-art" id="lib-art-'+pl.id+'">'+remoji(parseInt(pl.id)||k)+'</div><div class="search-card-title">'+pl.name+'</div><div class="search-card-artist">'+pl.songs.length+' 首</div></div>';
    // Lazy-load cover from first song in playlist
    if(pl.songs.length>0) (function(pid,path){
      invoke('read_cover_art',{path:path}).then(function(dataUrl){
        if(!dataUrl) return;
        var el=document.getElementById('lib-art-'+pid);
        if(el){ el.style.backgroundImage='url('+dataUrl+')'; el.style.backgroundSize='cover'; el.textContent=''; }
      }).catch(function(){});
    })(pl.id, pl.songs[0].path);
  }
  $('libraryGrid').innerHTML = h;
  if($('libraryGrid')){
    var cs=$('libraryGrid').querySelectorAll('.search-card');
    for(var c=0;c<cs.length;c++) (function(pid){
      cs[c].addEventListener('click',function(){ switchPlaylist(pid); });
    })(cs[c].dataset.pid);
  }
}

// ---- Folder scanning & sidebar ----
function rebuildSidebar(playlists){
  allPls = playlists || [];
  var list=$('playlistList');
  // Keep favorites item
  list.innerHTML='';
  var favLi=document.createElement('li');
  favLi.className='playlist-item favorites'; favLi.dataset.id='fav';
  favLi.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" style="color:var(--text);flex-shrink:0"><path fill="currentColor" d="m12 21-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18z"/></svg><div class="pl-info"><span class="pl-name">收藏夹</span><span class="pl-count" id="favCount">'+loved.length+' 首</span></div>';
  favLi.addEventListener('click',function(){ showFavorites(); });
  list.appendChild(favLi);
  for(var i=0;i<allPls.length;i++){
    var pl=allPls[i];
    var li=document.createElement('li');
    li.className='playlist-item'+(i===0?' active':'');
    li.dataset.id=pl.id;
    li.innerHTML='<span class="pl-cover">'+pl.letter+'</span><div class="pl-info"><span class="pl-name">'+pl.name+'</span><span class="pl-count">'+pl.songs.length+' 首</span></div>';
    (function(pid){ li.addEventListener('click',function(e){ switchPlaylist(pid); }); })(pl.id);
    list.appendChild(li);
  }
  updateOnboarding();
  // Show first playlist if available
  if(allPls.length>0 && currentPlId==='all' && allPls[0]){
    switchPlaylist(allPls[0].id);
  }
}

async function addFolder(){
  try{
    var result = await invoke('pick_folder',{});
    if(result){
      $('searchInput').placeholder = '正在扫描 ' + result + ' ...';
      var scanResult = await cmdAddScanDir(result);
      if(scanResult && scanResult.playlists){
        rebuildSidebar(scanResult.playlists);
        $('searchInput').placeholder = '搜索本地音乐...';
      } else {
        $('searchInput').placeholder = '未找到音频文件';
        setTimeout(function(){ $('searchInput').placeholder='搜索本地音乐...'; }, 3000);
      }
    }
  }catch(e){
    var path = prompt('请输入音乐文件夹路径:');
    if(path){
      $('searchInput').placeholder = '正在扫描...';
      var scanResult = await cmdAddScanDir(path);
      if(scanResult && scanResult.playlists){
        rebuildSidebar(scanResult.playlists);
        $('searchInput').placeholder = '搜索本地音乐...';
      } else {
        $('searchInput').placeholder = '未找到音频文件';
        setTimeout(function(){ $('searchInput').placeholder='搜索本地音乐...'; }, 3000);
      }
    }
  }
}

async function restoreSession(){
  // Library is already built by Rust on startup from persisted dirs.
  // Just fetch the current library to populate the sidebar.
  try{
    var lib = await cmdLibrary();
    if(lib && lib.playlists && lib.playlists.length > 0){
      rebuildSidebar(lib.playlists);
    }
  }catch(e){
    console.warn('Restore session failed:', e);
  }
}

// ---- Event Listeners & Init ----
function init(){
  // Audio events — bind once, rAF progress functions at module level
  if(audio){
    audio.addEventListener('playing', startProgressLoop);
    audio.addEventListener('pause', stopProgressLoop);
    audio.addEventListener('ended',function(){ stopProgressLoop(); if(cur) endSong(); });
    audio.addEventListener('error',function(){
      stopProgressLoop();
      console.warn('Audio error:', audio.error ? audio.error.message : 'unknown');
      if(cur){ usingAudio=false; }
    });
    audio.addEventListener('loadedmetadata',function(){
      if(audio.duration&&!isNaN(audio.duration)&&cur) dur=audio.duration;
      $('totalTime').textContent=fmt(dur);
    });
  }

  // Playback controls
  $('playPauseBtn').addEventListener('click',togglePlay);
  $('prevBtn').addEventListener('click',prevTrack);
  $('nextBtn').addEventListener('click',nextTrack);
  $('likeBtn').addEventListener('click',function(){
    if(!cur || !cur.path) return;
    var i=-1;
    for(var n=0;n<loved.length;n++){ if(normPath(loved[n])===normPath(cur.path)){ i=n; break; } }
    if(i>=0) loved.splice(i,1);
    else loved.push(cur.path);
    this.classList.toggle('liked',i<0);
    saveLoved();
    var fc=document.getElementById('favCount'); if(fc) fc.textContent=loved.length+' 首';
    var activePl=document.querySelector('.playlist-item.active');
    if(activePl&&activePl.dataset.id==='fav') showFavorites();
  });
  $('playAllBtn').addEventListener('click',function(){ if(queue.length) playSong(queue[0]); });
  $('shuffleBtn').addEventListener('click',function(){
    if(queue.length) playSong(queue[Math.floor(Math.random()*queue.length)]);
  });
  $('progressBar').addEventListener('click',seekProg);
  $('volumeBar').addEventListener('click',seekVol);
  $('muteBtn').addEventListener('click',function(){
    if(vol>0){ this._pv=vol; vol=0; }
    else{ vol=this._pv||0.7; }
    $('volumeFill').style.width=(vol*100)+'%';
    if(audio) audio.volume=vol;
    this.classList.toggle('muted',vol===0);
  });
  $('spectrumBtn').addEventListener('click',openSpectrum);
  $('spectrumClose').addEventListener('click',closeSpectrum);

  // Lyrics
  $('lyricsBtn').addEventListener('click',openLyrics);
  $('lyricsClose').addEventListener('click',closeLyrics);
  $('lyricsColorScheme').addEventListener('change',function(){
    _lyricsScheme = this.value;
    try{ localStorage.setItem('op_ds_lyrics_scheme', _lyricsScheme); }catch(e){}
    // Regenerate spectrum colors
    var colors=getLyricsColors(); _specColors=[];
    for(var si=0;si<SPEC_N;si++){
      if(colors.length===1 && colors[0]==='__RANDOM__') _specColors.push('#'+Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0'));
      else _specColors.push(colors[si%colors.length]);
    }
    if($('lyricsOverlay').classList.contains('active')) renderLyricsWordCloud([]);
  });
  window.addEventListener('resize',function(){
    if($('lyricsOverlay').classList.contains('active')) renderLyricsWordCloud([]);
  });

  // Search
  $('searchInput').addEventListener('keydown',function(e){
    if(e.key==='Enter'){ onSearch(this.value); }
    else if(e.key==='Escape'){ this.value=''; this.blur(); }
  });
  $('searchInput').addEventListener('focus',function(){ switchView('search'); });

  // Nav buttons
  var ns=document.querySelectorAll('.nav-item');
  for(var n=0;n<ns.length;n++) (function(v){
    ns[n].addEventListener('click',function(){ switchView(v); });
  })(ns[n].dataset.view);

  // Theme toggle
  var currentTheme = 'light';
  try { currentTheme = localStorage.getItem('op_ds_theme') || 'light'; } catch(e){}
  if(currentTheme==='blue') document.documentElement.setAttribute('data-theme','blue');
  $('themeBtn').addEventListener('click',function(){
    if(currentTheme==='blue'){
      document.documentElement.removeAttribute('data-theme');
      currentTheme = 'light';
    } else {
      document.documentElement.setAttribute('data-theme','blue');
      currentTheme = 'blue';
    }
    try { localStorage.setItem('op_ds_theme', currentTheme); } catch(e){}
  });

  // Add folder buttons
  $('addFolderBtn').addEventListener('click',addFolder);
  $('onboardAddBtn').addEventListener('click',addFolder);

  // Settings panel
  $('settingsBtn').addEventListener('click',function(){
    $('settingsOverlay').classList.add('active');
    // Refresh autostart state
    invoke('get_autostart').then(function(on){ $('autostartCheck').checked = !!on; })
      .catch(function(){});
  });
  $('settingsClose').addEventListener('click',function(){ $('settingsOverlay').classList.remove('active'); });
  $('settingsOverlay').addEventListener('click',function(e){ if(e.target===this) $('settingsOverlay').classList.remove('active'); });
  $('autostartCheck').addEventListener('change',function(){
    invoke('set_autostart',{enable:this.checked}).catch(function(e){ console.warn('set_autostart:',e); });
  });

  // Export favorites as ZIP
  $('exportFavBtn').addEventListener('click',async function(){
    if(loved.length===0){ alert('收藏夹为空，没有可导出的文件。'); return; }
    try{
      var dest = await invoke('pick_save_path');
      if(!dest) return;
      // Ensure .zip extension
      if(!dest.toLowerCase().endsWith('.zip')) dest += '.zip';
      $('exportFavBtn').style.opacity = '0.5';
      await invoke('export_favorites_zip',{paths:loved,dest:dest});
      alert('已导出 ' + loved.length + ' 首歌曲到:\n' + dest);
      $('exportFavBtn').style.opacity = '';
    }catch(e){
      console.warn('export failed:',e);
      alert('导出失败: ' + (e.message||e));
      $('exportFavBtn').style.opacity = '';
    }
  });

  // Clear cache button
  $('clearCacheBtn').addEventListener('click',function(){
    if(!confirm('确定要清除所有导入记录和收藏吗？此操作不可撤销。')) return;
    invoke('clear_all_data').then(function(){
      loved = [];
      allPls = [];
      queue = [];
      cur = null;
      idx = -1;
      playing = false;
      usingAudio = false;
      if(audio){ audio.pause(); try{audio.removeAttribute('src');audio.load();}catch(e){} }
      $('playIcon').style.display='block'; $('pauseIcon').style.display='none';
      $('nowPlayingArt').classList.remove('playing');
      $('nowPlayingTitle').textContent = '未在播放';
      $('nowPlayingArtist').textContent = '选择一首歌开始';
      $('nowPlayingInitials').textContent = '♪';
      $('songsList').innerHTML = '';
      $('libraryGrid').innerHTML = '';
      $('heroTitle').textContent = '全部歌曲';
      $('heroDesc').textContent = '浏览你的音乐收藏';
      rebuildSidebar([]);
      updateOnboarding();
    }).catch(function(e){ console.warn('clear_all_data failed:',e); });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown',function(e){
    if(e.target.tagName==='INPUT') return;
    if(e.code==='Space'){ e.preventDefault(); togglePlay(); }
    else if(e.code==='ArrowRight'&&(e.metaKey||e.ctrlKey)) nextTrack();
    else if(e.code==='ArrowLeft'&&(e.metaKey||e.ctrlKey)) prevTrack();
    else if((e.metaKey||e.ctrlKey)&&e.code==='KeyK'){ e.preventDefault(); $('searchInput').focus(); switchView('search'); }
  });

  // Volume init
  $('volumeFill').style.width=(vol*100)+'%';
  if(audio) audio.volume=vol;

  // Load favorites from disk FIRST (validates files exist, auto-removes stale),
  // then restore library scan. This ensures favCount is correct from the start.
  loadLoved().then(function(){
    return restoreSession();
  }).then(function(){
    var fc=document.getElementById('favCount'); if(fc) fc.textContent=loved.length+' 首';
  });
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();
})();
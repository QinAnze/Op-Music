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
var specVals=null, specRAF=null, specColor=null, analyser=null, actx=null, specData=null;
var SPEC_N=32;
try{ loved=JSON.parse(localStorage.getItem('op_ds_loved')||'[]'); }catch(e){ loved=[]; }
function saveLoved(){ try{localStorage.setItem('op_ds_loved',JSON.stringify(loved));}catch(e){} }
var audio = $('audioPlayer');
function cmdScan(dirs){ return invoke('scan_directories',{dirs:dirs}); }
function cmdLibrary(){ return invoke('get_library',{}); }
function cmdPlaylist(id){ return invoke('get_playlist',{playlistId:id}); }
function cmdSearch(kw){ return invoke('search_library',{keyword:kw}); }
function cmdScanDirs(){ return invoke('get_scan_dirs',{}); }
function cmdStats(){ return invoke('get_library_stats',{}); }

// ---- Playback ----
function updateLikeBtn(){
  var btn=$('likeBtn'); if(btn) btn.classList.toggle('liked', cur && loved.indexOf(cur.id)>=0);
}
function updateSpectrumInfo(){
  if(!cur) return;
  $('spectrumArt').textContent = remoji(cur.id);
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
  // Disable transition for instant reset, then re-enable
  var pf=$('progressFill'), pt=$('progressThumb');
  pf.style.transition = 'none'; pt.style.transition = 'none';
  pf.style.width = '0%'; pt.style.left = '0%';
  void pf.offsetWidth; // force reflow so the instant reset is painted
  pf.style.transition = ''; pt.style.transition = '';
  var rows = document.querySelectorAll('.song-row');
  for(var r=0;r<rows.length;r++) rows[r].classList.toggle('playing', Number(rows[r].dataset.id)===s.id);
  usingAudio = false;
  if(audio){ audio.pause(); try{audio.removeAttribute('src');audio.load();}catch(e){} }
  playing=true; $('playIcon').style.display='none'; $('pauseIcon').style.display='block';
  $('nowPlayingArt').classList.add('playing');
  var myGen = ++_playGen;
  updateLikeBtn();
  updateSpectrumInfo();

  // Load via Rust base64 data URL — same pattern as original fetch()
  console.log('Loading audio:', s.path);
  $('nowPlayingTitle').textContent = s.title + ' ⏳';

  invoke('read_audio_data_url', { path: s.path }).then(function(dataUrl){
    if(!cur||cur.id!==s.id) return;
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
    console.log('Playback started:', cur.title);
    $('nowPlayingTitle').textContent = cur.title;
  }).catch(function(e){
    console.warn('Play failed:', e && e.message);
    if(!cur || cur.id!==s.id) return;
    usingAudio = false;
    $('nowPlayingTitle').textContent = cur.title + ' ❌';
  });
}
var pT=null;
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
    $('progressThumb').style.left=p+'%';
    $('currentTime').textContent=fmt(prog);
    pT=requestAnimationFrame(tick);
  })();
}
function stopProg(){ if(pT){ cancelAnimationFrame(pT); pT=null; } }
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
  $('progressThumb').style.left=pct+'%';
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
  if(!specColor) specColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim()||'#1c1917';
  ctx.fillStyle = specColor;
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
  for(var j=0;j<libSongs.length;j++) if(loved.indexOf(libSongs[j].id)>=0) matched.push(libSongs[j]);
  // dedup
  var seen={}, uniq=[];
  for(var k=0;k<matched.length;k++){ if(!seen[matched[k].id]){ seen[matched[k].id]=true; uniq.push(matched[k]); } }
  var pl={id:'fav',name:'收藏夹',letter:'♥',songs:uniq};
  var items=document.querySelectorAll('.playlist-item');
  for(var m=0;m<items.length;m++) items[m].classList.toggle('active', items[m].dataset.id==='fav');
  currentPlId='fav';
  renderSongs(pl);
  switchView('discover');
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
    h+='<div class="search-card" data-idx="'+i+'"><div class="search-card-art">'+remoji(s.id)+'</div><div class="search-card-title">'+s.title+'</div><div class="search-card-artist">'+(s.artist||'Unknown')+'</div></div>';
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
    h+='<div class="search-card" data-pid="'+pl.id+'"><div class="search-card-art">'+remoji(parseInt(pl.id)||k)+'</div><div class="search-card-title">'+pl.name+'</div><div class="search-card-artist">'+pl.songs.length+' 首</div></div>';
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

async function scanFolder(path){
  try{
    var result = await cmdScan([path]);
    rebuildSidebar(result.playlists);
    return result;
  }catch(e){
    console.warn('Scan failed:', e);
    return null;
  }
}

async function addFolder(){
  // For now, prompt for path. In Tauri, we could use the dialog plugin.
  // But dialog in Tauri v2 with folder picking requires the dialog plugin
  // which we have registered. Let's check if it's available.
  try{
    var result = await invoke('pick_folder',{});
    if(result){
      $('searchInput').placeholder = '正在扫描 ' + result + ' ...';
      var scanResult = await scanFolder(result);
      if(scanResult){
        $('searchInput').placeholder = '搜索本地音乐...';
      } else {
        $('searchInput').placeholder = '未找到音频文件';
        setTimeout(function(){ $('searchInput').placeholder='搜索本地音乐...'; }, 3000);
      }
    }
  }catch(e){
    // Fallback: use prompt
    var path = prompt('请输入音乐文件夹路径:');
    if(path){
      $('searchInput').placeholder = '正在扫描...';
      var scanResult = await scanFolder(path);
      if(scanResult){
        $('searchInput').placeholder = '搜索本地音乐...';
      } else {
        $('searchInput').placeholder = '未找到音频文件';
        setTimeout(function(){ $('searchInput').placeholder='搜索本地音乐...'; }, 3000);
      }
    }
  }
}

async function restoreSession(){
  try{
    var dirs = await cmdScanDirs();
    if(dirs && dirs.length>0){
      var result = await cmdScan(dirs);
      rebuildSidebar(result.playlists);
    }
  }catch(e){
    console.warn('Restore session failed:', e);
  }
}

// ---- Event Listeners & Init ----
function init(){
  // Audio events — bind once, same as original
  if(audio){
    audio.addEventListener('timeupdate',function(){
      if(_progGen!==_playGen||!cur) return;
      prog=audio.currentTime;
      if(audio.duration&&!isNaN(audio.duration)) dur=audio.duration;
      poff=prog;
      var p=dur?(prog/dur)*100:0;
      $('progressFill').style.width=p+'%';
      $('progressThumb').style.left=p+'%';
      $('currentTime').textContent=fmt(prog);
    });
    audio.addEventListener('ended',function(){ if(cur) endSong(); });
    audio.addEventListener('error',function(){
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
    if(!cur) return;
    var i=loved.indexOf(cur.id);
    if(i>=0) loved.splice(i,1);
    else loved.push(cur.id);
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

  // Add folder buttons
  $('addFolderBtn').addEventListener('click',addFolder);
  $('onboardAddBtn').addEventListener('click',addFolder);

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

  // Restore session (scan previously selected folders)
  restoreSession();
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();
})();
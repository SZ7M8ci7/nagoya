(() => {
  'use strict';
  const {spots,geometry}=window.KYOTO_DATA;
  const $=s=>document.querySelector(s);
  const svg=d3.select('#map');
  const pane=$('.map-pane');
  const select=$('#spot-select');
  const areaSelect=$('#area-select');
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration=reduceMotion?0:320;
  let selected=1,width=0,height=0,projection,zoom,world,transform=d3.zoomIdentity;
  const groups={all:spots.map(d=>d.id),east:[8,9,10,11,12,13,14],north:[1,2,3,4,5,6,7],station:[15,16,17,18,22],west:[20,21],south:[19]};
  const shortNames={2:'もみじのトンネル',12:'知恩院',19:'醍醐寺',21:'トロッコ嵯峨駅'};
  const names=new Set(['京都駅','出町柳駅','嵯峨嵐山駅','八瀬比叡山口駅','山科駅','二条駅','御所','鴨川','高野川','北区','上京区','中京区','下京区','東山区']);
  const seen=new Set();
  const labels=geometry.labels.filter(d=>names.has(d.name)&&d.geometry.type==='Point'&&!seen.has(d.name)&&seen.add(d.name));
  spots.forEach(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=`${String(d.id).padStart(2,'0')}　${d.name}`;select.append(o)});

  function choose(id,{pan=false}={}){
    const d=spots.find(d=>d.id===Number(id));if(!d)return;
    selected=d.id;select.value=d.id;
    $('#selection-status').textContent=`${d.id} / ${spots.length}：${d.name}`;
    $('#spot-number').textContent=String(d.id).padStart(2,'0');
    $('#spot-name').textContent=d.name;$('#spot-area').textContent=d.area;
    $('#spot-photo').src=d.image;$('#spot-photo').alt=`${d.name}の夜の紅葉ライトアップ。${d.photoNote}`;
    $('#photo-open').setAttribute('aria-label',`${d.name}の写真を全画面で表示`);
    $('#spot-location').textContent=d.visitNote||d.locationNote||`${d.area}のライトアップ`;
    $('#event-link').hidden=!d.eventURL;
    if(d.eventURL)$('#event-link').href=d.eventURL;
    $('#photo-note').textContent=d.photoNote;
    $('#photo-source').href=d.photoSource;$('#location-source').href=d.sourceURL;
    $('#google-map').href=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.mapQuery||d.name+' 京都')}`;
    if(projection){drawPins();if(pan)focusSpot(d)}
  }
  function overlaps(a,b){return a.x<b.x+b.w+4&&a.x+a.w+4>b.x&&a.y<b.y+b.h+3&&a.y+a.h+3>b.y}
  function drawPins(){
    const nodes=spots.map(d=>{const [ax,ay]=transform.apply(projection([d.lon,d.lat]));return {...d,ax,ay,x:ax,y:ay}}).filter(d=>d.ax>15&&d.ax<width-15&&d.ay>20&&d.ay<height-20);
    const paneRect=pane.getBoundingClientRect();
    const obstacles=[...pane.querySelectorAll('.date-chip,.area-picker,.map-controls')].map(el=>{
      const r=el.getBoundingClientRect();return {left:r.left-paneRect.left-24,right:r.right-paneRect.left+24,top:r.top-paneRect.top-24,bottom:r.bottom-paneRect.top+24};
    });
    const simulation=d3.forceSimulation(nodes).force('x',d3.forceX(d=>d.ax).strength(.32)).force('y',d3.forceY(d=>d.ay).strength(.32)).force('collide',d3.forceCollide(23).iterations(4)).stop();
    // Reserve full touch targets around floating controls, including on short screens.
    for(let i=0;i<65;i++){
      simulation.tick();
      nodes.forEach(d=>{
        d.x=Math.max(23,Math.min(width-23,d.x));d.y=Math.max(27,Math.min(height-30,d.y));
        for(const r of obstacles){
          if(d.x<=r.left||d.x>=r.right||d.y<=r.top||d.y>=r.bottom)continue;
          const choices=[{x:r.left,y:d.y},{x:r.right,y:d.y},{x:d.x,y:r.top},{x:d.x,y:r.bottom}].filter(p=>p.x>=23&&p.x<=width-23&&p.y>=27&&p.y<=height-30);
          choices.sort((a,b)=>Math.hypot(a.x-d.x,a.y-d.y)-Math.hypot(b.x-d.x,b.y-d.y));
          if(choices.length){d.x=choices[0].x;d.y=choices[0].y}
        }
      });
    }
    svg.select('.leaders').selectAll('path').data(nodes,d=>d.id).join('path').attr('class','leader').attr('d',d=>`M${d.ax},${d.ay}L${d.x},${d.y}`);
    svg.select('.locations').selectAll('circle').data(nodes,d=>d.id).join('circle').attr('class','location-dot').attr('cx',d=>d.ax).attr('cy',d=>d.ay).attr('r',1.8);
    const pins=svg.select('.pins').selectAll('g').data(nodes,d=>d.id).join(enter=>{const g=enter.append('g');g.append('circle').attr('class','pin-ring').attr('r',22);g.append('circle').attr('class','pin-face').attr('r',16);g.append('text').attr('class','pin-number');g.append('circle').attr('class','pin-hit').attr('r',22);return g});
    pins.attr('class',d=>`map-pin${d.id===selected?' is-selected':''}`).attr('transform',d=>`translate(${d.x},${d.y})`).attr('role','button').attr('tabindex',0).attr('aria-label',d=>`${d.id}. ${d.name}の写真を見る`).attr('aria-pressed',d=>d.id===selected?'true':'false').attr('data-spot-id',d=>d.id).on('click',(event,d)=>{event.stopPropagation();choose(d.id)}).on('keydown',(event,d)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(d.id)}});
    pins.select('.pin-number').text(d=>d.id);
    pins.filter(d=>d.id===selected).raise();
    const used=nodes.map(d=>({x:d.x-22,y:d.y-22,w:44,h:44}));
    used.push({x:width-152,y:height-77,w:152,h:77},{x:0,y:0,w:width,h:60});
    const text=[];
    for(const d of [...nodes].sort((a,b)=>(b.id===selected)-(a.id===selected))){
      if(d.id!==selected&&transform.k<1.8)continue;
      const name=shortNames[d.id]||d.name,w=name.length*11+4,h=16;
      const options=[{x:d.x+24,y:d.y-8,w,h},{x:d.x-w-24,y:d.y-8,w,h},{x:d.x-w/2,y:d.y+25,w,h},{x:d.x-w/2,y:d.y-40,w,h}];
      const box=options.find(b=>b.x>5&&b.x+b.w<width-5&&b.y>5&&b.y+b.h<height-18&&!used.some(u=>overlaps(b,u)));
      if(box){used.push(box);text.push({...box,text:name,selected:d.id===selected})}
    }
    svg.select('.place-labels').selectAll('text').data(text).join('text').attr('class',d=>`place-label${d.selected?' selected':''}`).attr('x',d=>d.x).attr('y',d=>d.y+12).text(d=>d.text);
    const base=[];
    for(const d of [...labels].sort((a,b)=>(b.name==='京都駅')-(a.name==='京都駅'))){
      if(width<500&&transform.k<1.7&&!['京都駅','出町柳駅','嵯峨嵐山駅'].includes(d.name))continue;
      const [x,y]=transform.apply(projection(d.geometry.coordinates));const box={x:x-d.name.length*5,y:y-7,w:d.name.length*10,h:14};
      if(box.x>10&&box.x+box.w<width-10&&box.y>45&&box.y+box.h<height-25&&!used.some(u=>overlaps(box,u))){base.push({...d,x,y});used.push(box)}
    }
    svg.select('.base-labels').selectAll('text').data(base).join('text').attr('class','base-label').attr('x',d=>d.x).attr('y',d=>d.y).attr('text-anchor','middle').text(d=>d.name);
    const km=transform.k>4?.5:transform.k>1.8?1:2;
    const a=projection([135.75,35.02]),b=projection([135.75+km/(111.32*Math.cos(35.02*Math.PI/180)),35.02]);const len=(b[0]-a[0])*transform.k,x=14,y=height-28;
    svg.select('.scale-line').attr('d',`M${x},${y-4}V${y}H${x+len}V${y-4}`);svg.select('.scale-label').attr('x',x+len/2).attr('y',y-7).text(`${km} km`);
  }
  function move(t){svg.interrupt().transition().duration(duration).call(zoom.transform,t)}
  function focusSpot(d){
    const q=projection([d.lon,d.lat]),p=transform.apply(q);
    // Keep the overview while comparing photos; pan only when the next spot is off-screen.
    if(p[0]>32&&p[0]<width-32&&p[1]>60&&p[1]<height-65)return;
    const k=transform.k;move(d3.zoomIdentity.translate(width/2-q[0]*k,height/2-q[1]*k).scale(k));setArea(null);
  }
  function setArea(key){areaSelect.value=key||'custom'}
  function focusArea(key){
    if(key==='all'){move(d3.zoomIdentity);setArea('all');return}
    const list=spots.filter(d=>groups[key].includes(d.id));const pts=list.map(d=>projection([d.lon,d.lat]));
    const x0=d3.min(pts,p=>p[0]),x1=d3.max(pts,p=>p[0]),y0=d3.min(pts,p=>p[1]),y1=d3.max(pts,p=>p[1]);
    const k=Math.min(7,Math.max(1,Math.min((width-95)/Math.max(x1-x0,35),(height-100)/Math.max(y1-y0,35))));
    move(d3.zoomIdentity.translate(width/2-(x0+x1)*k/2,height/2-(y0+y1)*k/2).scale(k));setArea(key);
  }
  function draw(){
    const rect=pane.getBoundingClientRect(),w=Math.round(rect.width),h=Math.round(rect.height);if(w<1||h<1)return;
    const priorCenter=projection?projection.invert(transform.invert([width/2,height/2])):null,priorZoom=transform.k;
    width=w;height=h;svg.attr('viewBox',`0 0 ${width} ${height}`);
    projection=d3.geoMercator().fitExtent([[34,72],[width-34,height-83]],{type:'FeatureCollection',features:spots.map(d=>({type:'Feature',geometry:{type:'Point',coordinates:[d.lon,d.lat]}}))});
    const path=d3.geoPath(projection);svg.selectAll('*').remove();
    world=svg.append('g').attr('class','world');
    for(const [layer,cls] of [['WA','water'],['AdmBdry','boundary'],['RdCL','road'],['RailCL','rail'],['RvrCL','river']])world.append('path').datum(geometry.layers[layer]).attr('class',cls).attr('d',path).attr('vector-effect','non-scaling-stroke');
    ['base-labels','leaders','locations','pins','place-labels'].forEach(cls=>svg.append('g').attr('class',cls));
    svg.append('path').attr('class','scale-line');svg.append('text').attr('class','scale-label');
    zoom=d3.zoom().scaleExtent([1,10]).translateExtent([[-width*.7,-height*.7],[width*1.7,height*1.7]]).extent([[0,0],[width,height]]).filter(e=>e.type==='wheel'?true:!e.button).on('zoom',e=>{transform=e.transform;world.attr('transform',transform);drawPins()});
    svg.call(zoom).on('dblclick.zoom',null);
    if(priorCenter&&priorZoom>1.05){const p=projection(priorCenter);svg.call(zoom.transform,d3.zoomIdentity.translate(width/2-p[0]*priorZoom,height/2-p[1]*priorZoom).scale(priorZoom))}else svg.call(zoom.transform,d3.zoomIdentity);
  }
  select.addEventListener('change',()=>choose(select.value,{pan:true}));
  $('#prev-spot').addEventListener('click',()=>choose(selected===1?23:selected-1,{pan:true}));
  $('#next-spot').addEventListener('click',()=>choose(selected===23?1:selected+1,{pan:true}));
  $('#zoom-in').addEventListener('click',()=>{svg.transition().duration(duration).call(zoom.scaleBy,1.65);setArea(null)});
  $('#zoom-out').addEventListener('click',()=>{svg.transition().duration(duration).call(zoom.scaleBy,1/1.65);setArea(null)});
  $('#reset-map').addEventListener('click',()=>focusArea('all'));
  areaSelect.addEventListener('change',()=>focusArea(areaSelect.value));
  const details=$('#details-dialog');
  $('#details-open').addEventListener('click',()=>details.showModal());
  $('#details-close').addEventListener('click',()=>details.close());
  details.addEventListener('click',e=>{
    const r=details.getBoundingClientRect();
    if(e.target===details&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))details.close();
  });
  const dialog=$('#photo-dialog');
  $('#photo-open').addEventListener('click',()=>{const d=spots.find(d=>d.id===selected);$('#large-photo').src=d.image;$('#large-photo').alt=$('#spot-photo').alt;$('#large-title').textContent=d.name;$('#large-caption').textContent=d.photoNote;dialog.showModal()});
  $('#photo-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
  choose(1);draw();
  let timer;new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{const r=pane.getBoundingClientRect();if(Math.abs(r.width-width)>2||Math.abs(r.height-height)>2)draw()},80)}).observe(pane);
})();

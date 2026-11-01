// Measure only the decoded preview owned by the caller. Animation frames share
// one local-coordinate envelope; cropping/centering each frame would move anchors.
export function visibleImageBounds(image, rectangles, threshold = 0) {
  const scratch = document.createElement('canvas');
  scratch.width = image.naturalWidth || image.width;
  scratch.height = image.naturalHeight || image.height;
  const ctx = scratch.getContext('2d', {willReadFrequently:true});
  ctx.drawImage(image, 0, 0);
  const {data, width} = ctx.getImageData(0, 0, scratch.width, scratch.height);
  let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
  for (const [sx,sy,w,h] of rectangles) {
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      if (data[((sy+y)*width+sx+x)*4+3] <= threshold) continue;
      left=Math.min(left,x); top=Math.min(top,y);
      right=Math.max(right,x+1); bottom=Math.max(bottom,y+1);
    }
  }
  scratch.width=scratch.height=1;
  return Number.isFinite(left) ? {x:left,y:top,width:right-left,height:bottom-top,empty:false}
    : {x:0,y:0,width:rectangles[0][2],height:rectangles[0][3],empty:true};
}

export function fitImage(bounds, width, height, fill=.92) {
  const scale=Math.min(width/bounds.width,height/bounds.height)*fill;
  return {scale,x:(width-bounds.width*scale)/2-bounds.x*scale,
    y:(height-bounds.height*scale)/2-bounds.y*scale};
}

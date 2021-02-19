function debounce(func, wait, immediate) {
  let timeout;

  const debounced = function () {
    const context = this;
    const args = arguments;
    const later = function () {
      timeout = null;
      if (!immediate) {
        func.apply(context, args);
      }
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) {
      func.apply(context, args);
    }
  };

  debounced.cancel = () => {
    clearTimeout(timeout);
  };

  return debounced;
}

const data = areas.map((area, index) => {
  return {
    ...area,
    path: area.lnglat,
    name: `模拟社区${index}`,
    index,
    x: area.lnglat[0][0],
    y: area.lnglat[0][1],
  };
});

const map = new AMap.Map(document.querySelector('#app'), {
  mapStyle: 'amap://styles/grey',
  zoom: 14,
  center: [116.467987, 39.992613],
});

const index = new Supercluster();
index.load(data);

let markers = [];
let polygons = [];

const render = () => {
  let bounds = map.getBounds();
  if (bounds.toBounds) {
    bounds = bounds.toBounds();
  }
  const bbox = [
    bounds.southWest.lng,
    bounds.southWest.lat,
    bounds.northEast.lng,
    bounds.northEast.lat,
  ];
  const views = index.getClusters(bbox, map.getZoom());
  const clusters = views.filter((view) => view.isClutser);
  const data = views.filter((view) => !view.isClutser);

  map.remove(markers);
  markers = clusters.map((cluster) => {
    const marker = new AMap.Marker({
      ...cluster,
      content: `<div style="width: 32px; height: 32px; line-height: 32px; border-radius: 50%; background-color: green; color: #fff; text-align: center;">${cluster.count}</div>`,
    });
    return marker;
  });
  map.add(markers);

  map.remove(polygons);
  polygons = data.map((item) => {
    const marker = new AMap.Polygon({
      ...item,
      fillColor: 'rgba(256, 0, 0, 0.2)', // 多边形填充颜色
      borderWeight: 2, // 线条宽度，默认为 1
      strokeColor: 'rgba(256, 0, 0, 1)', // 线条颜色
    });
    return marker;
  });
  map.add(polygons);
};

render();

const listener = debounce(render, 200);
map.on('zoom', listener);
map.on('moveend', listener);

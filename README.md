# 高德地图海量数据展示优化

> [在线 Demo](https://fantasticit.gitee.io/amap-data-tile/)

![示例](https://wipi.oss-cn-shanghai.aliyuncs.com/2021-02-19/20210219171220.jpg)

假设开发中，遇到这样一个需求：“接口返回一片地区内所有的小区的电子围栏，将小区绘制到高德地图上”。很容易写出下面这样的代码：

```js
const map = new Amap.Map();

for (const item of data) {
  const polygon = new AMap.Polygon(item);
  map.add(polygon);
}
```

![效果](https://wipi.oss-cn-shanghai.aliyuncs.com/2021-02-19/20210219171709.jpg)

效果大致可能就是这样，在实际运行中，很有可能会非常卡顿，因为绘制耗了大量时间，如果在地图上还有事件交互，也可能会非常卡顿。实际业务根本无法使用，这时候就要找办法性能优化，翻阅高德地图的文档示例，可能会发现有“集群”、“海量点”渲染优化等示例，但是实际上在项目中可能还是没法使用（比如这个需求是绘制小区）。

## 从数据出发

从接口层面来看，很有可能是后端吐出大规模地理信息数据，前端拿到数据后根据产品需求进行渲染，本质上都是在消费数据。最直接的方式是“单次消费全部数据进行全部渲染”，基本上会带来卡顿问题。让我们回到地图本身，当我们在地图上进行交互（比如移动地图、滚动缩放）时，地图看起来好像才会绘制当前视口能看到的地方，或者说就是这一片的瓦片。

所以，从地图本身的瓦片式渲染来看，我们对数据的消费也可以是这种形式，展示“当前视口内可以渲染的数据，当前缩放等级可以看到的数据”，进而大幅减少单次需要渲染的数据，性能自然就上去了。总结一下：

通过地图当前的视口、缩放登记，获取当前可以渲染的数据、被聚合的数据

## 代码实现

站在巨人的肩膀上，通过 `kd-brush` 和 `supercluster` 对数据进行消费。

```js
function sortKD(ids, coords, nodeSize, left, right, depth) {
  if (right - left <= nodeSize) {
    return;
  }

  const m = (left + right) >> 1;

  select(ids, coords, m, left, right, depth % 2);

  sortKD(ids, coords, nodeSize, left, m - 1, depth + 1);
  sortKD(ids, coords, nodeSize, m + 1, right, depth + 1);
}

function select(ids, coords, k, left, right, inc) {
  while (right > left) {
    if (right - left > 600) {
      const n = right - left + 1;
      const m = k - left + 1;
      const z = Math.log(n);
      const s = 0.5 * Math.exp((2 * z) / 3);
      const sd = 0.5 * Math.sqrt((z * s * (n - s)) / n) * (m - n / 2 < 0 ? -1 : 1);
      const newLeft = Math.max(left, Math.floor(k - (m * s) / n + sd));
      const newRight = Math.min(right, Math.floor(k + ((n - m) * s) / n + sd));
      select(ids, coords, k, newLeft, newRight, inc);
    }

    const t = coords[2 * k + inc];
    let i = left;
    let j = right;

    swapItem(ids, coords, left, k);
    if (coords[2 * right + inc] > t) {
      swapItem(ids, coords, left, right);
    }

    while (i < j) {
      swapItem(ids, coords, i, j);
      i++;
      j--;
      while (coords[2 * i + inc] < t) {
        i++;
      }
      while (coords[2 * j + inc] > t) {
        j--;
      }
    }

    if (coords[2 * left + inc] === t) {
      swapItem(ids, coords, left, j);
    } else {
      j++;
      swapItem(ids, coords, j, right);
    }

    if (j <= k) {
      left = j + 1;
    }
    if (k <= j) {
      right = j - 1;
    }
  }
}

function swapItem(ids, coords, i, j) {
  swap(ids, i, j);
  swap(coords, 2 * i, 2 * j);
  swap(coords, 2 * i + 1, 2 * j + 1);
}

function swap(arr, i, j) {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

function range(ids, coords, minX, minY, maxX, maxY, nodeSize) {
  const stack = [0, ids.length - 1, 0];
  const result = [];
  let x;
  let y;

  while (stack.length) {
    const axis = stack.pop();
    const right = stack.pop();
    const left = stack.pop();

    if (right - left <= nodeSize) {
      for (let i = left; i <= right; i++) {
        x = coords[2 * i];
        y = coords[2 * i + 1];
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          result.push(ids[i]);
        }
      }
      continue;
    }

    const m = Math.floor((left + right) / 2);

    x = coords[2 * m];
    y = coords[2 * m + 1];

    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      result.push(ids[m]);
    }

    const nextAxis = (axis + 1) % 2;

    if (axis === 0 ? minX <= x : minY <= y) {
      stack.push(left);
      stack.push(m - 1);
      stack.push(nextAxis);
    }
    if (axis === 0 ? maxX >= x : maxY >= y) {
      stack.push(m + 1);
      stack.push(right);
      stack.push(nextAxis);
    }
  }

  return result;
}

function within(ids, coords, qx, qy, r, nodeSize) {
  const stack = [0, ids.length - 1, 0];
  const result = [];
  const r2 = r * r;

  while (stack.length) {
    const axis = stack.pop();
    const right = stack.pop();
    const left = stack.pop();

    if (right - left <= nodeSize) {
      for (let i = left; i <= right; i++) {
        if (sqDist(coords[2 * i], coords[2 * i + 1], qx, qy) <= r2) {
          result.push(ids[i]);
        }
      }
      continue;
    }

    const m = Math.floor((left + right) / 2);

    const x = coords[2 * m];
    const y = coords[2 * m + 1];

    if (sqDist(x, y, qx, qy) <= r2) {
      result.push(ids[m]);
    }

    const nextAxis = (axis + 1) % 2;

    if (axis === 0 ? qx - r <= x : qy - r <= y) {
      stack.push(left);
      stack.push(m - 1);
      stack.push(nextAxis);
    }
    if (axis === 0 ? qx + r >= x : qy + r >= y) {
      stack.push(m + 1);
      stack.push(right);
      stack.push(nextAxis);
    }
  }

  return result;
}

function sqDist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

const defaultGetX = function (p) {
  return p[0];
};
const defaultGetY = function (p) {
  return p[1];
};

const KDBush = function KDBush(points, getX, getY, nodeSize, ArrayType) {
  if (getX === void 0) getX = defaultGetX;
  if (getY === void 0) getY = defaultGetY;
  if (nodeSize === void 0) nodeSize = 64;
  if (ArrayType === void 0) ArrayType = Float64Array;

  this.nodeSize = nodeSize;
  this.points = points;

  const IndexArrayType = points.length < 65536 ? Uint16Array : Uint32Array;

  const ids = (this.ids = new IndexArrayType(points.length));
  const coords = (this.coords = new ArrayType(points.length * 2));

  for (let i = 0; i < points.length; i++) {
    ids[i] = i;
    coords[2 * i] = getX(points[i]);
    coords[2 * i + 1] = getY(points[i]);
  }

  sortKD(ids, coords, nodeSize, 0, ids.length - 1, 0);
};

KDBush.prototype.range = function range$1(minX, minY, maxX, maxY) {
  return range(this.ids, this.coords, minX, minY, maxX, maxY, this.nodeSize);
};

KDBush.prototype.within = function within$1(x, y, r) {
  return within(this.ids, this.coords, x, y, r, this.nodeSize);
};

const defaultOptions = {
  minZoom: 3, // min zoom to generate clusters on
  maxZoom: 18, // max zoom level to cluster the points on
  minPoints: 4, // minimum points to form a cluster
  radius: 80, // cluster radius in pixels
  extent: 512, // tile extent (radius is calculated relative to it)
  nodeSize: 64, // size of the KD-tree leaf node, affects performance
  log: false, // whether to log timing info
  // whether to generate numeric ids for input features (in vector tiles)
  generateId: false,
  // a reduce function for calculating custom cluster properties
  reduce: null, // (accumulated, props) => { accumulated.sum += props.sum; }
  // properties to use for individual points when running the reducer
  map: (props) => props, // props => ({sum: props.my_value})
};

const fround =
  Math.fround ||
  ((tmp) => (x) => {
    tmp[0] = +x;
    return tmp[0];
  })(new Float32Array(1));

class Supercluster {
  constructor(options) {
    this.options = extend(Object.create(defaultOptions), options);
    this.trees = new Array(this.options.maxZoom + 1);
  }

  load(points) {
    const { log, minZoom, maxZoom, nodeSize } = this.options;

    if (log) console.time('total time');

    const timerId = `prepare ${points.length} points`;
    if (log) console.time(timerId);

    this.points = points;

    // generate a cluster object for each point and index input points into a KD-tree
    let clusters = [];
    for (let i = 0; i < points.length; i++) {
      // if (!points[i].geometry) continue;
      clusters.push(createPointCluster(points[i], i));
    }
    this.trees[maxZoom + 1] = new KDBush(clusters, getX, getY, nodeSize, Float32Array);

    if (log) console.timeEnd(timerId);

    // cluster points on max zoom, then cluster the results on previous zoom, etc.;
    // results in a cluster hierarchy across zoom levels
    for (let z = maxZoom; z >= minZoom; z--) {
      const now = +Date.now();

      // create a new set of clusters for the zoom and index them with a KD-tree
      clusters = this._cluster(clusters, z);
      this.trees[z] = new KDBush(clusters, getX, getY, nodeSize, Float32Array);

      if (log) console.log('z%d: %d clusters in %dms', z, clusters.length, +Date.now() - now);
    }

    if (log) console.timeEnd('total time');

    return this;
  }

  getClusters(bbox, zoom) {
    let minLng = ((((bbox[0] + 180) % 360) + 360) % 360) - 180;
    const minLat = Math.max(-90, Math.min(90, bbox[1]));
    let maxLng = bbox[2] === 180 ? 180 : ((((bbox[2] + 180) % 360) + 360) % 360) - 180;
    const maxLat = Math.max(-90, Math.min(90, bbox[3]));

    if (bbox[2] - bbox[0] >= 360) {
      minLng = -180;
      maxLng = 180;
    } else if (minLng > maxLng) {
      const easternHem = this.getClusters([minLng, minLat, 180, maxLat], zoom);
      const westernHem = this.getClusters([-180, minLat, maxLng, maxLat], zoom);
      return easternHem.concat(westernHem);
    }

    const tree = this.trees[this._limitZoom(zoom)];
    const ids = tree.range(lngX(minLng), latY(maxLat), lngX(maxLng), latY(minLat));
    const clusters = [];
    for (const id of ids) {
      const c = tree.points[id];
      clusters.push(c.numPoints ? getClusterJSON(c) : this.points[c.index]);
    }
    return clusters;
  }

  getChildren(clusterId) {
    const originId = this._getOriginId(clusterId);
    const originZoom = this._getOriginZoom(clusterId);
    const errorMsg = 'No cluster with the specified id.';

    const index = this.trees[originZoom];
    if (!index) {
      console.error(errorMsg);
      return [];
    }

    const origin = index.points[originId];
    if (!origin) {
      console.error(errorMsg);
      return [];
    }

    const r = this.options.radius / (this.options.extent * Math.pow(2, originZoom - 1));
    const ids = index.within(origin.x, origin.y, r);
    const children = [];
    for (const id of ids) {
      const c = index.points[id];
      if (c.parentId === clusterId) {
        children.push(c.numPoints ? getClusterJSON(c) : this.points[c.index]);
      }
    }

    return children;
  }

  getLeaves(clusterId, limit, offset) {
    limit = limit || 10;
    offset = offset || 0;

    const leaves = [];
    this._appendLeaves(leaves, clusterId, limit, offset, 0);

    return leaves;
  }

  getTile(z, x, y) {
    const tree = this.trees[this._limitZoom(z)];
    const z2 = Math.pow(2, z);
    const { extent, radius } = this.options;
    const p = radius / extent;
    const top = (y - p) / z2;
    const bottom = (y + 1 + p) / z2;

    const tile = {
      features: [],
    };

    this._addTileFeatures(
      tree.range((x - p) / z2, top, (x + 1 + p) / z2, bottom),
      tree.points,
      x,
      y,
      z2,
      tile
    );

    if (x === 0) {
      this._addTileFeatures(tree.range(1 - p / z2, top, 1, bottom), tree.points, z2, y, z2, tile);
    }
    if (x === z2 - 1) {
      this._addTileFeatures(tree.range(0, top, p / z2, bottom), tree.points, -1, y, z2, tile);
    }

    return tile.features.length ? tile : null;
  }

  getClusterExpansionZoom(clusterId) {
    let expansionZoom = this._getOriginZoom(clusterId) - 1;
    while (expansionZoom <= this.options.maxZoom) {
      const children = this.getChildren(clusterId);
      expansionZoom++;
      if (children.length !== 1) break;
      clusterId = children[0].properties.cluster_id;
    }
    return expansionZoom;
  }

  _appendLeaves(result, clusterId, limit, offset, skipped) {
    const children = this.getChildren(clusterId);

    for (const child of children) {
      const props = child.properties;

      if (props && props.cluster) {
        if (skipped + props.point_count <= offset) {
          // skip the whole cluster
          skipped += props.point_count;
        } else {
          // enter the cluster
          skipped = this._appendLeaves(result, props.cluster_id, limit, offset, skipped);
          // exit the cluster
        }
      } else if (skipped < offset) {
        // skip a single point
        skipped++;
      } else {
        // add a single point
        result.push(child);
      }
      if (result.length === limit) break;
    }

    return skipped;
  }

  _addTileFeatures(ids, points, x, y, z2, tile) {
    for (const i of ids) {
      const c = points[i];
      const isCluster = c.numPoints;
      const f = {
        type: 1,
        geometry: [
          [
            Math.round(this.options.extent * (c.x * z2 - x)),
            Math.round(this.options.extent * (c.y * z2 - y)),
          ],
        ],
        tags: isCluster ? getClusterProperties(c) : this.points[c.index].properties,
      };

      // assign id
      let id;
      if (isCluster) {
        id = c.id;
      } else if (this.options.generateId) {
        // optionally generate id
        id = c.index;
      } else if (this.points[c.index].id) {
        // keep id if already assigned
        id = this.points[c.index].id;
      }

      if (id !== undefined) f.id = id;

      tile.features.push(f);
    }
  }

  _limitZoom(z) {
    return Math.max(this.options.minZoom, Math.floor(Math.min(+z, this.options.maxZoom + 1)));
  }

  _cluster(points, zoom) {
    const clusters = [];
    const { radius, extent, reduce, minPoints } = this.options;
    const r = radius / (extent * Math.pow(2, zoom));

    // loop through each point
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      // if we've already visited the point at this zoom level, skip it
      if (p.zoom <= zoom) continue;
      p.zoom = zoom;

      // find all nearby points
      const tree = this.trees[zoom + 1];
      const neighborIds = tree.within(p.x, p.y, r);

      const numPointsOrigin = p.numPoints || 1;
      let numPoints = numPointsOrigin;

      // count the number of points in a potential cluster
      for (const neighborId of neighborIds) {
        const b = tree.points[neighborId];
        // filter out neighbors that are already processed
        if (b.zoom > zoom) numPoints += b.numPoints || 1;
      }

      if (numPoints >= minPoints) {
        // enough points to form a cluster
        let wx = p.x * numPointsOrigin;
        let wy = p.y * numPointsOrigin;

        let clusterProperties = reduce && numPointsOrigin > 1 ? this._map(p, true) : null;

        // encode both zoom and point index on which the cluster originated -- offset by total length of features
        const id = (i << 5) + (zoom + 1) + this.points.length;

        for (const neighborId of neighborIds) {
          const b = tree.points[neighborId];

          if (b.zoom <= zoom) continue;
          b.zoom = zoom; // save the zoom (so it doesn't get processed twice)

          const numPoints2 = b.numPoints || 1;
          wx += b.x * numPoints2; // accumulate coordinates for calculating weighted center
          wy += b.y * numPoints2;

          b.parentId = id;

          if (reduce) {
            if (!clusterProperties) clusterProperties = this._map(p, true);
            reduce(clusterProperties, this._map(b));
          }
        }

        p.parentId = id;
        clusters.push(
          createCluster(wx / numPoints, wy / numPoints, id, numPoints, clusterProperties)
        );
      } else {
        // left points as unclustered
        clusters.push(p);

        if (numPoints > 1) {
          for (const neighborId of neighborIds) {
            const b = tree.points[neighborId];
            if (b.zoom <= zoom) continue;
            b.zoom = zoom;
            clusters.push(b);
          }
        }
      }
    }

    return clusters;
  }

  // get index of the point from which the cluster originated
  _getOriginId(clusterId) {
    return (clusterId - this.points.length) >> 5;
  }

  // get zoom of the point from which the cluster originated
  _getOriginZoom(clusterId) {
    return (clusterId - this.points.length) % 32;
  }

  _map(point, clone) {
    if (point.numPoints) {
      return clone ? extend({}, point.properties) : point.properties;
    }
    const original = this.points[point.index].properties;
    const result = this.options.map(original);
    return clone && result === original ? extend({}, result) : result;
  }
}

function createCluster(x, y, id, numPoints, properties) {
  return {
    x: fround(x), // weighted cluster center; round for consistency with Float32Array index
    y: fround(y),
    zoom: Infinity, // the last zoom the cluster was processed at
    id, // encodes index of the first child of the cluster and its zoom level
    parentId: -1, // parent cluster id
    numPoints,
    properties,
  };
}

function createPointCluster(p, id) {
  const x = 'x' in p ? p.x : p.position && p.position[0];
  const y = 'y' in p ? p.y : p.position && p.position[1];

  return {
    x: fround(lngX(x)), // projected point coordinates
    y: fround(latY(y)),
    zoom: Infinity, // the last zoom the point was processed at
    index: id, // index of the source feature in the original input array,
    parentId: -1, // parent cluster id
  };
}

function getClusterJSON(cluster) {
  return {
    isClutser: true,
    id: cluster.id,
    ...getClusterProperties(cluster),
    x: xLng(cluster.x),
    y: yLat(cluster.y),
    position: [xLng(cluster.x), yLat(cluster.y)],
  };
}

function getClusterProperties(cluster) {
  const count = cluster.numPoints;
  const abbrev =
    count >= 10000
      ? `${Math.round(count / 1000)}k`
      : count >= 1000
      ? `${Math.round(count / 100) / 10}k`
      : count;
  return extend(extend({}, cluster.properties), {
    cluster: true,
    cluster_id: cluster.id,
    count,
    abbreviatedCount: abbrev,
  });
}

// longitude/latitude to spherical mercator in [0..1] range
function lngX(lng) {
  return lng / 360 + 0.5;
}
function latY(lat) {
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI;
  return y < 0 ? 0 : y > 1 ? 1 : y;
}

// spherical mercator to longitude/latitude
function xLng(x) {
  return (x - 0.5) * 360;
}
function yLat(y) {
  const y2 = ((180 - y * 360) * Math.PI) / 180;
  return (360 * Math.atan(Math.exp(y2))) / Math.PI - 90;
}

function extend(dest, src) {
  for (const id in src) dest[id] = src[id];
  return dest;
}

function getX(p) {
  return p.x;
}
function getY(p) {
  return p.y;
}
```

## 使用

![效果]()

```js
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
```

![效果](https://gitee.com/fantasticit/amap-data-tile/raw/master/amap-point-tile-480.gif)

## 源码

[在线 Demo](https://fantasticit.gitee.io/amap-data-tile/)
[源码](https://github.com/fantasticit/amap-data-tile)

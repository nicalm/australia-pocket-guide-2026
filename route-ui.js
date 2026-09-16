/* Geographic illustrated route map with licensed landmark photography. */
let mapRoutes = [];
let mapInstance = 0;
let activePhotoTargets = new Map();

const transportNames = {
  drive: "自驾", train: "火车", rail: "火车", "cable-car": "缆车",
  hike: "步行", walk: "步行", return: "返程", "rental-car": "租车",
  boat: "游船", ferry: "渡轮", flight: "飞行", transfer: "接驳"
};

function mapCityDefinitions(source) {
  return Array.isArray(source.cities) ? source.cities : [];
}

function mapCityFor(source, cityId) {
  return mapCityDefinitions(source).find((city) => city.id === cityId) || null;
}

function mapRouteDefinitions(source, city = null) {
  const byDay = new Map();
  for (const route of (city || source).routes || []) {
    if (!byDay.has(route.day)) byDay.set(route.day, { day: route.day, color: route.color || MAP_ROUTE_PALETTE[(route.day - 1) % MAP_ROUTE_PALETTE.length] });
  }
  return [...byDay.values()].sort((first, second) => first.day - second.day);
}

function dailyMapLayoutFor(source, dayNumber, city = null) {
  const authored = (city?.dailyLayouts || source.dailyLayouts)?.[String(dayNumber)];
  if (authored) return { places: [], transport: [], viewport: null, ...authored };
  const allowedIds = city ? new Set(city.placeIds || []) : null;
  const routes = (source.routes || []).filter((route) => route.day === dayNumber).map((route) => ({
    ...route,
    placeIds: allowedIds ? (route.placeIds || []).filter((id) => allowedIds.has(id)) : route.placeIds || []
  }));
  return routes.length ? { places: [...new Set(routes.flatMap((route) => route.placeIds || []))], transport: [], viewport: null } : null;
}

function mapPlacesFor(source) {
  return (source.places || []).map((place) => {
    const canonical = (state.data?.places || []).find((entry) => entry.id === place.id) || {};
    return {
      ...place,
      label: place.nameZh || canonical.nameZh || place.name || canonical.name || place.id,
      query: place.query || canonical.navigation?.query || canonical.googleMapsQuery || canonical.address || place.nameZh || place.name || place.id
    };
  });
}

function scheduleItemsForPin(day, pin) {
  const references = Array.isArray(pin?.itemIds) && pin.itemIds.length ? pin.itemIds : pin?.items || [];
  return references.map((reference) => typeof reference === "number"
    ? day.schedule[reference]
    : day.schedule.find((item) => item.id === reference)
  ).filter(Boolean);
}

function safeWebUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function photoAttributionMarkup(photo) {
  const sourceUrl = safeWebUrl(photo.sourceUrl);
  const licenseUrl = safeWebUrl(photo.licenseUrl);
  const author = escapeHtml(photo.author || "Wikimedia Commons contributor");
  const license = escapeHtml(photo.license || "查看来源");
  const source = sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${author}</a>` : author;
  const rights = licenseUrl ? `<a href="${escapeHtml(licenseUrl)}" target="_blank" rel="noopener noreferrer">${license}</a>` : license;
  return `${source} · ${rights}`;
}

function transportIcon(type) {
  const icons = {
    drive: '<path d="m5 9 2-5h10l2 5M4 9h16v9H4zM7 18v2m10-2v2M7 12h1m8 0h1"/>',
    "cable-car": '<path d="m2 4 20-2M12 3v5M6 9h12l2 9H4zM6 18v3h12v-3M9 9v9m6-9v9"/>',
    train: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 10h14M12 3v7m-4 5h1m6 0h1M8 18l-3 4m11-4 3 4M7 20h10"/>',
    hike: '<circle cx="14" cy="4" r="2"/><path d="m11 8 4 2 3 4m-7-6-3 6-4 1m7-3 3 4-1 6m-2-10-3 7-4 3M8 8l-2 3"/>',
    boat: '<path d="M12 3v11M5 7h14v6M3 14l9-3 9 3-3 6H6zM2 22q3-3 5 0 3-3 5 0 3-3 5 0 3-3 5 0"/>',
    flight: '<path d="M3 16 21 8M9 13 5 6l2-1 6 5m2-1 1-6 2-1 1 5M8 15l-1 4 2-1 3-4"/>'
  };
  const key = type === "rail" ? "train" : type === "ferry" ? "boat" : type === "walk" ? "hike" : ["return", "transfer"].includes(type) ? "drive" : type;
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[key] || icons.drive}</svg>`;
}

function photoStripMarkup(places) {
  const photos = places.filter((place) => place.photo);
  if (!photos.length) return "";
  return `<div class="illustrated-photo-strip" aria-label="本区域景点照片">${photos.map((place) => `
    <button type="button" data-map-photo-place="${escapeHtml(place.id)}" aria-label="在地图中查看 ${escapeHtml(place.label)}">
      <img src="${escapeHtml(place.photo.url)}" alt="${escapeHtml(place.photo.alt)}" loading="lazy">
      <span>${escapeHtml(place.label)}</span>
    </button>`).join("")}</div>`;
}

function markerLayout(places, viewport, routeMode, surfaceWidth, surfaceHeight) {
  const result = new Map();
  if (!routeMode) return result;
  const occupied = [{ left: 8, top: 8, right: Math.min(surfaceWidth * 0.7, 330), bottom: 84 }];
  const pointCandidates = [[0, 0], [0, -36], [34, -22], [34, 22], [0, 36], [-34, 22], [-34, -22], [52, 0], [-52, 0], [54, -42], [-54, -42], [54, 42], [-54, 42], [0, -60], [0, 60]];
  const photoCandidates = [[58, -54], [-58, -54], [58, 54], [-58, 54], [0, -72], [0, 72], [82, 0], [-82, 0], [88, -65], [-88, -65], [88, 65], [-88, 65]];
  const ordered = [...places].sort((first, second) => Number(Boolean(second.photo?.marker)) - Number(Boolean(first.photo?.marker)));
  for (const place of ordered) {
    const centerX = (place.x - viewport.x) / viewport.width * surfaceWidth;
    const centerY = (place.y - viewport.y) / viewport.height * surfaceHeight;
    const photo = Boolean(place.photo?.marker);
    const width = photo ? 66 : 24;
    const height = photo ? 76 : 24;
    let best;
    for (const [dx, dy] of photo ? photoCandidates : pointCandidates) {
      const box = { left: centerX + dx - width / 2 - 8, top: centerY + dy - height / 2 - 8, right: centerX + dx + width / 2 + 8, bottom: centerY + dy + height / 2 + 8 };
      const outside = Math.max(0, 6 - box.left) + Math.max(0, box.right - (surfaceWidth - 6)) + Math.max(0, 6 - box.top) + Math.max(0, box.bottom - (surfaceHeight - 6));
      const overlap = occupied.reduce((sum, other) => sum + Math.max(0, Math.min(box.right, other.right) - Math.max(box.left, other.left)) * Math.max(0, Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top)), 0);
      const score = outside * 100000 + overlap * 1000 + Math.hypot(dx, dy);
      if (!best || score < best.score) best = { dx, dy, box, score };
      if (!outside && !overlap) break;
    }
    occupied.push(best.box);
    result.set(place.id, { dx: best.dx, dy: best.dy });
  }
  return result;
}

function offsetStyle(offset, prefix) {
  const dx = Number(offset?.dx || 0);
  const dy = Number(offset?.dy || 0);
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(-dy, -dx) * 180 / Math.PI;
  return `--${prefix}-dx:${dx}px;--${prefix}-dy:${dy}px;--leader-length:${length}px;--leader-angle:${angle}deg;--anchor-x:${-dx}px;--anchor-y:${-dy}px`;
}

function photoMarkerMarkup(place, viewport, routeMode, index, offset) {
  if (!place.photo?.marker) return "";
  if (!routeMode && !place.photo.overview) return "";
  const x = (place.x - viewport.x) / viewport.width * 100;
  const y = (place.y - viewport.y) / viewport.height * 100;
  const displaced = routeMode && (offset?.dx || offset?.dy);
  return `<button type="button" class="illustrated-photo-marker${displaced ? " is-offset" : ""}" style="left:${x}%;top:${y}%;${offsetStyle(offset, "photo")}" data-map-photo-place="${escapeHtml(place.id)}" aria-label="${escapeHtml(place.label)}，查看照片和地图">
    <img src="${escapeHtml(place.photo.url)}" alt="">
    <b>${index + 1}</b>
    <span>${escapeHtml(place.label)}</span>
  </button>`;
}

function pointMarkerMarkup(place, viewport, index, offset) {
  const x = (place.x - viewport.x) / viewport.width * 100;
  const y = (place.y - viewport.y) / viewport.height * 100;
  const displaced = offset?.dx || offset?.dy;
  return `<button type="button" class="illustrated-point-marker${displaced ? " is-offset" : ""}" style="left:${x}%;top:${y}%;--marker-color:${escapeHtml(place.color || "#397dc1")};${offsetStyle(offset, "point")}" data-map-photo-place="${escapeHtml(place.id)}" aria-label="${index + 1}：${escapeHtml(place.label)}，查看地点"><span>${index + 1}</span></button>`;
}

function transportMarkup(source, route, viewport, city = null) {
  if (!route) return "";
  const layout = dailyMapLayoutFor(source, route.day, city);
  const day = state.data.days.find((item) => item.day === route.day);
  return (layout?.transport || []).map((pin, index) => {
    const item = scheduleItemsForPin(day, pin)[0];
    if (!item || !Number.isFinite(Number(pin.x)) || !Number.isFinite(Number(pin.y))) return "";
    const x = (pin.x - viewport.x) / viewport.width * 100;
    const y = (pin.y - viewport.y) / viewport.height * 100;
    return `<button type="button" class="illustrated-transport-marker" style="left:${x}%;top:${y}%;--marker-color:${escapeHtml(route.color)}" data-transport-day="${route.day}" data-transport-group="${index}" aria-label="${escapeHtml(transportNames[item.type] || "交通")}：${escapeHtml(item.text)}">${transportIcon(item.type)}</button>`;
  }).join("");
}

function routePathFromPlaces(placeIds, places, seed = 0) {
  const points = placeIds.map((placeId) => places.find((place) => place.id === placeId)).filter(Boolean);
  if (points.length < 2) return "";
  let result = `M${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const bend = ((seed + index) % 2 ? 1 : -1) * Math.min(26, length * 0.09);
    const nx = -dy / length;
    const ny = dx / length;
    result += ` C${(previous.x + dx * 0.34 + nx * bend).toFixed(1)} ${(previous.y + dy * 0.34 + ny * bend).toFixed(1)} ${(previous.x + dx * 0.68 + nx * bend).toFixed(1)} ${(previous.y + dy * 0.68 + ny * bend).toFixed(1)} ${current.x} ${current.y}`;
  }
  return result;
}

function routesForView(source, city = null, route = null) {
  return ((city || source).routes || []).filter((entry) => !route || entry.day === route.day);
}

function routeSvgMarkup(source, route, viewport, city = null) {
  const routes = routesForView(source, city, route);
  return `<svg class="illustrated-route-overlay" viewBox="${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}" aria-hidden="true">
    ${routes.map((entry) => (entry.paths || []).map((pathData) => `<path d="${escapeHtml(pathData)}" stroke="#fffdf6" stroke-width="11" opacity=".74" vector-effect="non-scaling-stroke"/><path d="${escapeHtml(pathData)}" stroke="${escapeHtml(entry.color)}" stroke-width="6.5" vector-effect="non-scaling-stroke"/>`).join("")).join("")}
  </svg>`;
}

function photoPopupMarkup(place) {
  const photo = place.photo;
  return `<article class="illustrated-photo-popup${photo ? " has-photo" : ""}">
    ${photo ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt)}">` : ""}
    <div><strong>${escapeHtml(place.label)}</strong>
      ${photo ? `<small>${photoAttributionMarkup(photo)}</small>` : ""}
      <a href="${escapeHtml(mapsSearch(place.query))}" target="_blank" rel="noopener noreferrer">在 Google Maps 中查看 ↗</a>
    </div>
  </article>`;
}

function googleMyMapsId(city) {
  const mapId = String(city?.googleMyMaps?.mapId || "").trim();
  return /^[A-Za-z0-9_-]+$/.test(mapId) ? mapId : "";
}

function googleMyMapsMarkup(source, city, route) {
  const mapId = googleMyMapsId(city);
  if (!mapId) return "";
  const places = mapPlacesFor(city);
  const layout = route ? dailyMapLayoutFor(source, route.day, city) : null;
  const contextPlaces = route
    ? (layout?.places || []).map((placeId) => places.find((place) => place.id === placeId)).filter(Boolean)
    : (city.placeIds || []).map((placeId) => places.find((place) => place.id === placeId)).filter(Boolean);
  const day = route && state.data.days.find((item) => item.day === route.day);
  const embedUrl = `https://www.google.com/maps/d/embed?mid=${encodeURIComponent(mapId)}&ehbc=2E312F`;
  const viewerUrl = `https://www.google.com/maps/d/viewer?mid=${encodeURIComponent(mapId)}`;
  activePhotoTargets = new Map(places.map((place) => [place.id, place]));
  return `<div class="google-mymaps-block">
    <div class="google-mymaps-context">
      <div>
        <small>${route ? `DAY ${String(route.day).padStart(2, "0")} · ${escapeHtml(day?.date?.slice(5).replace("-", "/") || "")}` : "CITY MAP"}</small>
        <strong>${escapeHtml(route ? day?.title || city.label : city.label)}</strong>
      </div>
      ${route ? `<span>日期页复用城市总图；下方仅列出当天地点。</span>` : `<span>真实 Google 地图 · 景点与行程路线</span>`}
    </div>
    <div class="google-mymaps-frame">
      <iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(`${city.label} Google My Maps`)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
    </div>
    ${route && contextPlaces.length ? `<div class="illustrated-day-key">${contextPlaces.map((place, index) => `<span><b>${index + 1}</b>${escapeHtml(place.label)}</span>`).join("")}</div>` : ""}
    ${photoStripMarkup(contextPlaces)}
    <div class="illustrated-map-utility"><span>Google My Maps 为公开地图；路线仅表达计划顺序，不代表精确导航。</span><a href="${escapeHtml(viewerUrl)}" target="_blank" rel="noopener noreferrer">在 Google Maps 中打开 ↗</a></div>
  </div>`;
}

function openMapPopover(target, html) {
  document.querySelector(".illustrated-map-popover")?.remove();
  const popover = document.createElement("section");
  popover.className = "illustrated-map-popover";
  popover.innerHTML = `<button type="button" data-close-illustrated-popover aria-label="关闭">×</button>${html}`;
  document.body.append(popover);
  const box = target.getBoundingClientRect();
  const width = Math.min(320, innerWidth - 16);
  popover.style.width = `${width}px`;
  requestAnimationFrame(() => {
    popover.style.left = `${Math.max(8, Math.min(innerWidth - popover.offsetWidth - 8, box.left + box.width / 2 - popover.offsetWidth / 2))}px`;
    popover.style.top = `${Math.max(8, Math.min(innerHeight - popover.offsetHeight - 8, box.top - popover.offsetHeight - 10))}px`;
  });
}

function travelMapMarkup(source, city, route) {
  const id = `illustrated-travel-map-${++mapInstance}`;
  const viewSource = city || source;
  const canvas = viewSource.canvas || { width: 1448, height: 1086 };
  const viewport = route
    ? dailyMapLayoutFor(source, route.day, city)?.viewport || city?.viewport || { x: 0, y: 0, width: canvas.width, height: canvas.height }
    : { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const places = mapPlacesFor(viewSource);
  const layout = route ? dailyMapLayoutFor(source, route.day, city) : null;
  const visibleIds = route
    ? new Set(layout?.places || [])
    : new Set(viewSource.overviewPlaceIds || places.map((place) => place.id));
  const routeOrder = [...new Set(routesForView(source, city, route).flatMap((entry) => entry.placeIds || []))];
  const orderedIds = [...routeOrder, ...visibleIds].filter((id, index, values) => values.indexOf(id) === index);
  const visiblePlaces = orderedIds.map((placeId) => places.find((place) => place.id === placeId)).filter((place) => place && visibleIds.has(place.id));
  const day = route && state.data.days.find((item) => item.day === route.day);
  const surfaceWidth = Math.max(280, Math.min(1100, $("#route-explorer")?.clientWidth || innerWidth - 36));
  const detailMode = Boolean(city || route);
  const offsets = markerLayout(visiblePlaces, viewport, detailMode, surfaceWidth, surfaceWidth * 0.75);
  const placeKey = detailMode ? `<div class="illustrated-day-key">${visiblePlaces.map((place, index) => `<span><b>${index + 1}</b>${escapeHtml(place.label)}</span>`).join("")}</div>` : "";
  const contextPlaces = route
    ? (layout?.places || []).map((placeId) => places.find((place) => place.id === placeId)).filter(Boolean)
    : city
      ? (city.placeIds || []).map((placeId) => places.find((place) => place.id === placeId)).filter(Boolean)
      : places;
  activePhotoTargets = new Map(places.map((place) => [place.id, place]));
  return `<div class="illustrated-map-block">
    <div class="illustrated-map-canvas" id="${id}">
      <img src="${escapeHtml(viewSource.baseImage)}" alt="" style="width:${canvas.width / viewport.width * 100}%;height:${canvas.height / viewport.height * 100}%;left:${-viewport.x / viewport.width * 100}%;top:${-viewport.y / viewport.height * 100}%">
      ${routeSvgMarkup(source, route, viewport, city)}
      ${route ? `<div class="illustrated-daily-heading"><small>DAY ${String(route.day).padStart(2, "0")} · ${escapeHtml(day.date.slice(5).replace("-", "/"))}</small><strong>${escapeHtml(day.title)}</strong></div>` : city ? `<div class="illustrated-daily-heading"><small>CITY MAP</small><strong>${escapeHtml(city.label)}</strong></div>` : ""}
      ${visiblePlaces.map((place, index) => place.photo ? photoMarkerMarkup(place, viewport, detailMode, index, offsets.get(place.id)) : pointMarkerMarkup(place, viewport, index, offsets.get(place.id))).join("")}
      ${transportMarkup(source, route, viewport, city)}
    </div>
    ${placeKey}
    ${photoStripMarkup(contextPlaces)}
    <div class="illustrated-map-utility"><span>${escapeHtml(source.disclaimer || "底图按真实国家边界和地点经纬度绘制，路线仅表达行程顺序。")}</span><button type="button" data-expand-map="${id}">全屏查看 ↗</button></div>
  </div>`;
}

function routeMapMarkup(source, city, route) {
  if (city && googleMyMapsId(city)) return googleMyMapsMarkup(source, city, route);
  const fallback = city && state.data?.map?.cityMapMode === "google-my-maps"
    ? `<p class="google-mymaps-fallback" role="status">此城市的 Google My Maps 尚未配置，暂时显示本地插画地图。</p>`
    : "";
  return `${fallback}${travelMapMarkup(source, city, route)}`;
}

function renderRoutePanel(regionId, cityId = "", dayNumber = 0) {
  const root = $("#route-explorer");
  const routeMap = state.data?.routeMap;
  const regions = travelMapRegions(routeMap);
  const source = travelMapSource(routeMap, regionId || routeMap?.defaultRegionId || root.dataset.region);
  root.dataset.region = source.id || "";
  const cities = mapCityDefinitions(source);
  const city = mapCityFor(source, cityId || root.dataset.city);
  root.dataset.city = city?.id || "";
  mapRoutes = mapRouteDefinitions(source, city);
  const route = mapRoutes.find((item) => item.day === dayNumber);
  document.querySelector(".illustrated-map-popover")?.remove();
  root.innerHTML = `<div class="route-region-tabs" aria-label="旅行国家">${regions.map((region) => `<button type="button" data-route-region="${escapeHtml(region.id)}" aria-pressed="${region.id === source.id}">${escapeHtml(region.label || region.id)}</button>`).join("")}</div>
    <div class="route-city-tabs" aria-label="${escapeHtml(source.label || "当前国家")}城市"><button type="button" data-route-city="" aria-pressed="${!city}">国家总览</button>${cities.map((item) => `<button type="button" data-route-city="${escapeHtml(item.id)}" aria-pressed="${item.id === city?.id}">${escapeHtml(item.label)}</button>`).join("")}</div>
    ${city ? `<div class="route-day-tabs" aria-label="${escapeHtml(city.label)}路线日期"><button type="button" data-route-day="0" aria-pressed="${!route}">城市总览</button>${mapRoutes.map((item) => { const day = state.data.days.find((candidate) => candidate.day === item.day); return day ? `<button type="button" data-route-day="${item.day}" style="--route-color:${item.color}" aria-pressed="${item === route}"><i></i>${day.date.slice(5).replace("-", "/")}</button>` : ""; }).join("")}</div>` : ""}
  ${routeMapMarkup(source, city, route)}`;
}

function setupRouteExplorer() {
  renderRoutePanel();
  document.addEventListener("click", (event) => {
    const region = event.target.closest("[data-route-region]");
    const city = event.target.closest("[data-route-city]");
    const dayButton = event.target.closest("[data-route-day]");
    if (region || city || dayButton) {
      const selectedRegionId = region?.dataset.routeRegion || $("#route-explorer").dataset.region;
      const selectedCityId = region ? "" : city ? city.dataset.routeCity : $("#route-explorer").dataset.city;
      renderRoutePanel(selectedRegionId, selectedCityId, region || city ? 0 : Number(dayButton.dataset.routeDay));
      return;
    }
    if (event.target.closest("[data-close-illustrated-popover]")) {
      event.target.closest(".illustrated-map-popover").remove();
      return;
    }
    const placeButton = event.target.closest("[data-map-photo-place]");
    if (placeButton) {
      const place = activePhotoTargets.get(placeButton.dataset.mapPhotoPlace);
      if (place) {
        const target = document.querySelector(`.illustrated-map-canvas [data-map-photo-place="${CSS.escape(place.id)}"]`) || placeButton;
        openMapPopover(target, photoPopupMarkup(place));
      }
      return;
    }
    const transport = event.target.closest("[data-transport-day]");
    if (transport) {
      const source = travelMapSource(state.data.routeMap, $("#route-explorer").dataset.region);
      const city = mapCityFor(source, $("#route-explorer").dataset.city);
      const day = state.data.days.find((item) => item.day === Number(transport.dataset.transportDay));
      const pin = dailyMapLayoutFor(source, day.day, city).transport[Number(transport.dataset.transportGroup)];
      openMapPopover(transport, `<div class="illustrated-transport-popup">${scheduleItemsForPin(day, pin).map((item) => `<strong>${escapeHtml(transportNames[item.type] || "交通")} · ${escapeHtml(item.time)}</strong><p>${escapeHtml(item.text)}</p>`).join("")}</div>`);
      return;
    }
    const expand = event.target.closest("[data-expand-map]");
    if (expand) {
      const dialog = $("#map-dialog");
      const source = document.getElementById(expand.dataset.expandMap);
      const copy = source.cloneNode(true);
      copy.removeAttribute("id");
      $("#map-dialog-content").replaceChildren(copy);
      dialog.showModal();
      return;
    }
    if (!event.target.closest(".illustrated-map-popover")) document.querySelector(".illustrated-map-popover")?.remove();
  });
  $("#map-close").onclick = () => $("#map-dialog").close();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") document.querySelector(".illustrated-map-popover")?.remove();
  });
}

(function () {
  const data = window.KHIVA_DATA;
  if (!data) {
    console.error("KHIVA_DATA not loaded.");
    return;
  }

  const landmarkMap = new Map(data.landmarks.map((lm) => [lm.id, lm]));

  // Application State
  const state = {
    landmarkId: "all",
    camera: "all",
    timeFilter: "all",
    activeTab: "landmarks",
    filteredItems: [...data.items],
    currentDialogIndex: 0,
    isPlaying: false,
    playTimer: null,
    activeMobileNav: "map",
    currentPreviewItem: null,
    layersVisible: {
      clusters: true,
      landmarks: true,
      walls: true,
      path: true,
      heat: false,
    },
    currentBasemap: "satellite",
  };

  // Detect Mobile
  function isMobile() {
    return window.innerWidth <= 820;
  }

  // Initialize Leaflet Map centered on Itchan Kala
  const map = L.map("map", {
    center: [41.3782, 60.3598],
    zoom: isMobile() ? 16 : 17,
    maxZoom: 20,
    zoomControl: false,
  });

  L.control.zoom({ position: isMobile() ? "bottomright" : "bottomright" }).addTo(map);

  // Base Layers
  const baseLayers = {
    satellite: L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 20,
        maxNativeZoom: 19,
        attribution: "Tiles &copy; Esri — World Imagery",
      }
    ),
    osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }),
    voyager: L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap &copy; CARTO",
      }
    ),
    dark: L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap &copy; CARTO",
      }
    ),
  };

  baseLayers.satellite.addTo(map);

  // 1. Itchan Kala Mud-Brick Fortification Wall Layer
  const wallsLayer = L.layerGroup().addTo(map);
  const wallOuterGlow = L.polyline(data.walls, {
    color: "#f59e0b",
    weight: isMobile() ? 6 : 8,
    opacity: 0.28,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(wallsLayer);

  const wallLine = L.polyline(data.walls, {
    color: "#fde68a",
    weight: isMobile() ? 2.5 : 3,
    dashArray: "8, 6",
    opacity: 0.9,
  }).addTo(wallsLayer);

  wallLine.bindTooltip(
    "<strong>Itchan Kala Mud-Brick Fortification Walls</strong><br>UNESCO World Heritage Perimeter (2.2 km)",
    { sticky: true }
  );

  // 2. Chronological Walking Route Layer
  const pathLayer = L.layerGroup().addTo(map);

  // 3. Historical Monument Badges Layer
  const landmarksLayer = L.layerGroup().addTo(map);

  // 4. Photo Thumbnail Cluster Layer
  const clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: isMobile() ? 48 : 42,
    spiderfyOnMaxZoom: true,
    zoomToBoundsOnClick: true,
    iconCreateFunction: function (cluster) {
      const childMarkers = cluster.getAllChildMarkers();
      const firstItem = childMarkers[0]?.options?.itemData;
      const thumbUrl = firstItem ? firstItem.thumb : "thumbs/20261015_083121.jpg";
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `
          <div class="photo-cluster-icon">
            <img src="${thumbUrl}" alt="Cluster of ${count} photos" loading="lazy" width="48" height="48" />
            <span class="photo-cluster-count">${count}</span>
          </div>
        `,
        className: "",
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      });
    },
  });
  map.addLayer(clusterGroup);

  // 5. Heatmap Layer
  let heatLayer = null;

  // 6. Animated Traveler Marker for Scrubber
  let travelerMarker = null;

  // Populate Landmark Dropdown
  const landmarkSelect = document.getElementById("landmarkSelect");
  data.landmarks
    .slice()
    .sort((a, b) => b.count - a.count)
    .forEach((lm) => {
      const opt = document.createElement("option");
      opt.value = lm.id;
      opt.textContent = `${lm.name} (${lm.count})`;
      landmarkSelect.appendChild(opt);
    });

  // Render Historical Monument Labels on Map
  function renderLandmarkMarkers() {
    landmarksLayer.clearLayers();
    data.landmarks.forEach((lm) => {
      if (lm.id === "urgench-arrival" && state.landmarkId !== "urgench-arrival") {
        return;
      }
      const icon = L.divIcon({
        html: `<div class="landmark-map-badge" style="border-color:${lm.color}">🏛️ ${lm.name.split("(")[0].trim()} <span style="opacity:0.75">(${lm.count})</span></div>`,
        className: "",
        iconSize: [0, 0],
      });
      const marker = L.marker([lm.lat, lm.lon], { icon, zIndexOffset: 500 });
      marker.on("click", () => {
        selectLandmark(lm.id, true);
      });
      landmarksLayer.addLayer(marker);
    });
  }

  // Filter Items
  function applyFilters() {
    state.filteredItems = data.items.filter((it) => {
      if (state.landmarkId !== "all" && it.landmarkId !== state.landmarkId) {
        return false;
      }
      if (state.camera === "video") {
        if (it.type !== "video") return false;
      } else if (state.camera !== "all" && it.camera !== state.camera) {
        return false;
      }
      if (state.timeFilter === "day1" && it.day !== "2026-10-14") return false;
      if (state.timeFilter === "day2" && it.day !== "2026-10-15") return false;
      if (
        ["morning", "midday", "golden_hour", "night"].includes(state.timeFilter) &&
        it.timeOfDay !== state.timeFilter
      ) {
        return false;
      }
      return true;
    });

    const count = state.filteredItems.length;
    document.getElementById("statVisibleCount").textContent = count;
    document.getElementById("galleryCountTab").textContent = count;
    const mobileCount = document.getElementById("mobileShownCount");
    if (mobileCount) mobileCount.textContent = count;

    const slider = document.getElementById("timelineRange");
    slider.max = Math.max(0, count - 1);
    slider.value = 0;

    renderMapItems();
    renderSidebarLandmarks();
    renderSidebarGallery();
    updateScrubberInfo(0);
  }

  // Render Filtered Markers, Walking Path, and Heatmap on Map
  function renderMapItems() {
    clusterGroup.clearLayers();
    pathLayer.clearLayers();

    const day1Coords = [];
    const day2Coords = [];
    const heatPoints = [];

    const markers = state.filteredItems.map((it, idx) => {
      if (it.landmarkId !== "urgench-arrival") {
        if (it.day === "2026-10-14") {
          day1Coords.push([it.lat, it.lon]);
        } else {
          day2Coords.push([it.lat, it.lon]);
        }
        heatPoints.push([it.lat, it.lon, 0.7]);
      }

      const icon = L.divIcon({
        html: `
          <div class="photo-marker-pin ${it.type === "video" ? "is-video" : ""}">
            <img src="${it.thumb}" alt="${it.file}" loading="lazy" width="42" height="42" />
          </div>
        `,
        className: "",
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });

      const m = L.marker([it.lat, it.lon], { icon, itemData: it });
      const lm = landmarkMap.get(it.landmarkId);

      if (!isMobile()) {
        m.bindTooltip(
          `<strong>${lm ? lm.name : "Historical Khiva"}</strong><br>${formatDateTime(it.dt)} • ${it.type === "video" ? "🎥 POV Video" : "📷 Photo"}`,
          { direction: "top", offset: [0, -16] }
        );
      }

      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        showMarkerPreview(it, idx);
      });
      return m;
    });

    clusterGroup.addLayers(markers);

    if (day1Coords.length > 1) {
      L.polyline(day1Coords, {
        color: "#38bdf8",
        weight: isMobile() ? 2.5 : 3,
        opacity: 0.72,
        dashArray: "4, 6",
      })
        .bindTooltip("Day 1 Walking Track (Oct 14, 2026)")
        .addTo(pathLayer);
    }

    if (day2Coords.length > 1) {
      L.polyline(day2Coords, {
        color: "#34d399",
        weight: isMobile() ? 2.5 : 3,
        opacity: 0.72,
        dashArray: "4, 6",
      })
        .bindTooltip("Day 2 Walking Track (Oct 15, 2026)")
        .addTo(pathLayer);
    }

    if (heatLayer) {
      map.removeLayer(heatLayer);
    }
    heatLayer = L.heatLayer(heatPoints, {
      radius: isMobile() ? 20 : 24,
      blur: 16,
      maxZoom: 18,
    });
    if (state.layersVisible.heat) {
      heatLayer.addTo(map);
    }
  }

  // Show Marker Preview Card (Mobile bottom preview, or direct desktop open)
  function showMarkerPreview(item, idx) {
    state.currentPreviewItem = { item, idx };
    const card = document.getElementById("markerPreviewCard");
    const thumb = document.getElementById("previewCardThumb");
    const title = document.getElementById("previewCardTitle");
    const sub = document.getElementById("previewCardSub");
    const lm = landmarkMap.get(item.landmarkId);

    thumb.src = item.thumb;
    title.textContent = lm ? lm.name : "Historical Khiva";
    sub.textContent = `${formatDateTime(item.dt)} • ${item.type === "video" ? "🎥 POV Video" : "📷 Photo"}`;

    card.classList.add("visible");

    // On mobile, pan map slightly so marker isn't covered by bottom card
    if (isMobile()) {
      map.panTo([item.lat, item.lon], { animate: true });
    } else {
      openMediaDialog(idx);
    }
  }

  document.getElementById("previewCardCloseBtn").addEventListener("click", () => {
    document.getElementById("markerPreviewCard").classList.remove("visible");
    state.currentPreviewItem = null;
  });

  function openCurrentPreviewDialog() {
    if (state.currentPreviewItem) {
      openMediaDialog(state.currentPreviewItem.idx);
    }
  }

  document.getElementById("previewCardViewBtn").addEventListener("click", openCurrentPreviewDialog);
  document.getElementById("previewCardInfoClick").addEventListener("click", openCurrentPreviewDialog);

  map.on("click", () => {
    document.getElementById("markerPreviewCard").classList.remove("visible");
  });

  // Render Historical Monuments List in Sidebar
  function renderSidebarLandmarks() {
    const container = document.getElementById("landmarksView");
    container.innerHTML = "";

    const counts = new Map();
    data.items.forEach((it) => {
      if (state.camera === "video" && it.type !== "video") return;
      if (state.camera !== "all" && state.camera !== "video" && it.camera !== state.camera) return;
      if (state.timeFilter === "day1" && it.day !== "2026-10-14") return;
      if (state.timeFilter === "day2" && it.day !== "2026-10-15") return;
      if (
        ["morning", "midday", "golden_hour", "night"].includes(state.timeFilter) &&
        it.timeOfDay !== state.timeFilter
      ) {
        return;
      }
      counts.set(it.landmarkId, (counts.get(it.landmarkId) || 0) + 1);
    });

    data.landmarks
      .slice()
      .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0))
      .forEach((lm) => {
        const c = counts.get(lm.id) || 0;
        const card = document.createElement("div");
        card.className = `landmark-card ${state.landmarkId === lm.id ? "active" : ""}`;
        card.innerHTML = `
          <img class="landmark-thumb" src="${lm.coverThumb || "thumbs/20261015_083121.jpg"}" alt="${lm.name}" loading="lazy" width="72" height="72" />
          <div class="landmark-info">
            <div>
              <div class="landmark-top">
                <div class="landmark-name">${lm.name}</div>
                <span class="landmark-count">${c}</span>
              </div>
              <div class="landmark-era">${lm.era} • ${lm.category}</div>
              <p class="landmark-desc">${lm.summary}</p>
            </div>
          </div>
        `;
        card.addEventListener("click", () => {
          if (isMobile()) {
            closeMobileDrawer();
          }
          if (state.landmarkId === lm.id) {
            selectLandmark("all", true);
          } else {
            selectLandmark(lm.id, true);
          }
        });
        container.appendChild(card);
      });
  }

  // Render Geotagged Gallery Grid in Sidebar
  function renderSidebarGallery() {
    const container = document.getElementById("galleryView");
    container.innerHTML = "";

    const frag = document.createDocumentFragment();
    state.filteredItems.forEach((it, idx) => {
      const tile = document.createElement("div");
      tile.className = "photo-tile";
      const timeStr = it.dt ? it.dt.slice(11, 16) : "";
      tile.innerHTML = `
        <img src="${it.thumb}" alt="${it.file}" loading="lazy" width="110" height="110" />
        ${it.type === "video" ? `<span class="video-indicator">▶ ${it.duration || ""}s</span>` : ""}
        <div class="photo-tile-badge">
          <span>${it.day.slice(5)}</span>
          <span>${timeStr}</span>
        </div>
      `;
      tile.addEventListener("click", () => {
        openMediaDialog(idx);
      });
      frag.appendChild(tile);
    });
    container.appendChild(frag);
  }

  // Select Landmark & Fly
  function selectLandmark(id, fly = true) {
    state.landmarkId = id;
    landmarkSelect.value = id;
    const banner = document.getElementById("activeLandmarkBanner");

    if (id === "all") {
      banner.classList.remove("visible");
      if (fly) {
        map.flyTo([41.3782, 60.3598], isMobile() ? 16 : 17, { duration: 0.8 });
      }
    } else {
      const lm = landmarkMap.get(id);
      if (lm) {
        document.getElementById("bannerTitle").textContent = `${lm.name} (${lm.era})`;
        document.getElementById("bannerUzbek").textContent = `${lm.uzbekName} • ${lm.category}`;
        document.getElementById("bannerHistory").textContent = `${lm.summary} ${lm.history}`;
        banner.classList.add("visible");
        if (fly) {
          map.flyTo([lm.lat, lm.lon], isMobile() ? 18 : 19, { duration: 0.8 });
        }
      }
    }
    renderLandmarkMarkers();
    applyFilters();
  }

  function formatDateTime(dt) {
    if (!dt || dt.length < 16) return "Oct 2026";
    const dayStr = dt.slice(0, 10) === "2026:10:14" ? "Oct 14" : "Oct 15";
    return `${dayStr} • ${dt.slice(11, 16)}`;
  }

  // =========================================
  // LIGHTBOX MODAL DIALOG
  // =========================================
  const dialog = document.getElementById("mediaDialog");

  if (!("closedBy" in HTMLDialogElement.prototype)) {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (isDialogContent) return;
      dialog.close();
    });
  }

  dialog.addEventListener("close", () => {
    const container = document.getElementById("dialogMediaContainer");
    const vid = container.querySelector("video");
    if (vid) vid.pause();
    document.getElementById("dialogMetaPanel").classList.remove("open");
  });

  const dialogInfoBtn = document.getElementById("dialogInfoToggleBtn");
  if (dialogInfoBtn) {
    dialogInfoBtn.addEventListener("click", () => {
      document.getElementById("dialogMetaPanel").classList.toggle("open");
    });
  }

  function openMediaDialog(index) {
    if (!state.filteredItems.length) return;
    state.currentDialogIndex =
      (index + state.filteredItems.length) % state.filteredItems.length;
    const item = state.filteredItems[state.currentDialogIndex];
    const lm = landmarkMap.get(item.landmarkId);

    const container = document.getElementById("dialogMediaContainer");
    container.innerHTML = "";

    if (item.type === "video") {
      const video = document.createElement("video");
      video.src = item.src;
      video.poster = item.thumb;
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      container.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = item.src;
      img.alt = lm ? `${lm.name} — ${item.file}` : item.file;
      container.appendChild(img);
    }

    document.getElementById("dialogCategoryBadge").textContent = lm
      ? `${lm.category} • ${lm.era}`
      : "Geotagged Media";
    document.getElementById("dialogTitle").textContent = lm
      ? lm.name
      : "Historical Khiva";
    document.getElementById("dialogDateVal").textContent = formatDateTime(item.dt);
    document.getElementById("dialogCoordsVal").textContent = `${item.lat.toFixed(5)}° N, ${item.lon.toFixed(5)}° E`;
    document.getElementById("dialogCameraVal").textContent = item.camera;
    document.getElementById("dialogFileVal").textContent = `${item.file} (${item.w}×${item.h})`;
    document.getElementById("dialogHistoryText").innerHTML = lm
      ? `<strong>${lm.uzbekName}</strong><br>${lm.summary}<br><br>${lm.history}`
      : "";

    const openLink = document.getElementById("openOriginalLink");
    openLink.href = item.src;

    if (!dialog.open) {
      dialog.showModal();
    }
  }

  document.getElementById("prevMediaBtn").addEventListener("click", () => {
    openMediaDialog(state.currentDialogIndex - 1);
  });

  document.getElementById("nextMediaBtn").addEventListener("click", () => {
    openMediaDialog(state.currentDialogIndex + 1);
  });

  document.getElementById("flyToPinBtn").addEventListener("click", () => {
    const item = state.filteredItems[state.currentDialogIndex];
    if (!item) return;
    dialog.close();
    map.flyTo([item.lat, item.lon], 19, { duration: 0.8 });
    showTravelerMarker(item);
  });

  window.addEventListener("keydown", (e) => {
    if (!dialog.open) return;
    if (e.key === "ArrowLeft") {
      openMediaDialog(state.currentDialogIndex - 1);
    } else if (e.key === "ArrowRight") {
      openMediaDialog(state.currentDialogIndex + 1);
    }
  });

  // Touch swipe support for lightbox on mobile
  let touchStartX = 0;
  dialog.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  dialog.addEventListener("touchend", (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    const diff = touchEndX - touchStartX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        openMediaDialog(state.currentDialogIndex - 1);
      } else {
        openMediaDialog(state.currentDialogIndex + 1);
      }
    }
  }, { passive: true });

  // =========================================
  // TIMELINE SCRUBBER & ANIMATED WALK
  // =========================================
  function showTravelerMarker(item) {
    if (!item) return;
    if (!travelerMarker) {
      const icon = L.divIcon({
        html: `<div class="traveler-pulse"></div>`,
        className: "",
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      travelerMarker = L.marker([item.lat, item.lon], {
        icon,
        zIndexOffset: 2000,
      }).addTo(map);
    } else {
      travelerMarker.setLatLng([item.lat, item.lon]);
    }
    const lm = landmarkMap.get(item.landmarkId);
    travelerMarker
      .bindPopup(
        `<div style="text-align:center;min-width:140px">
          <img src="${item.thumb}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;margin-bottom:4px;cursor:pointer" id="popupThumbImg" />
          <div style="font-weight:700;font-size:11.5px;color:#0f172a">${lm ? lm.name.split("(")[0].trim() : "Khiva"}</div>
          <div style="font-size:10.5px;color:#475569">${formatDateTime(item.dt)}</div>
        </div>`,
        { autoPan: false }
      )
      .openPopup();

    setTimeout(() => {
      const popupImg = document.getElementById("popupThumbImg");
      if (popupImg) {
        popupImg.onclick = () => {
          const idx = state.filteredItems.indexOf(item);
          if (idx !== -1) openMediaDialog(idx);
        };
      }
    }, 30);
  }

  function updateScrubberInfo(idx) {
    const item = state.filteredItems[idx];
    if (!item) return;
    const lm = landmarkMap.get(item.landmarkId);
    document.getElementById("scrubberLabel").textContent = `${idx + 1} / ${state.filteredItems.length} • ${lm ? lm.name.split("(")[0].trim() : "Khiva"}`;
    document.getElementById("scrubberTimestamp").textContent = `${formatDateTime(item.dt)} (${item.camera.includes("Meta") ? "Meta" : "S25+"})`;
  }

  const timelineRange = document.getElementById("timelineRange");
  timelineRange.addEventListener("input", (e) => {
    const idx = parseInt(e.target.value, 10);
    const item = state.filteredItems[idx];
    if (!item) return;
    updateScrubberInfo(idx);
    showTravelerMarker(item);
    if (item.landmarkId !== "urgench-arrival") {
      map.panTo([item.lat, item.lon], { animate: true });
    }
  });

  const playBtn = document.getElementById("playJourneyBtn");
  playBtn.addEventListener("click", () => {
    if (state.isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  });

  function startPlayback() {
    if (!state.filteredItems.length) return;
    state.isPlaying = true;
    playBtn.textContent = "⏸ Pause";
    let idx = parseInt(timelineRange.value, 10);
    if (idx >= state.filteredItems.length - 1) idx = 0;

    state.playTimer = setInterval(() => {
      idx++;
      if (idx >= state.filteredItems.length) {
        stopPlayback();
        return;
      }
      timelineRange.value = idx;
      const item = state.filteredItems[idx];
      updateScrubberInfo(idx);
      showTravelerMarker(item);
      if (item.landmarkId !== "urgench-arrival") {
        map.panTo([item.lat, item.lon], { animate: true });
      }
    }, 650);
  }

  function stopPlayback() {
    state.isPlaying = false;
    playBtn.textContent = "▶ Play Walk";
    if (state.playTimer) {
      clearInterval(state.playTimer);
      state.playTimer = null;
    }
  }

  document.getElementById("timelineCloseBtn").addEventListener("click", () => {
    stopPlayback();
    document.getElementById("timelineDock").classList.remove("mobile-active");
    updateMobileNav("map");
  });

  // =========================================
  // MOBILE NAVIGATION & DRAWER SYSTEM
  // =========================================
  const sidebarDrawer = document.getElementById("sidebarDrawer");
  const drawerCloseBtn = document.getElementById("drawerCloseBtn");

  function openMobileDrawer(tab) {
    sidebarDrawer.classList.add("drawer-open");
    document.getElementById("timelineDock").classList.remove("mobile-active");
    document.getElementById("markerPreviewCard").classList.remove("visible");

    if (tab === "monuments") {
      tabLandmarksBtn.click();
      document.getElementById("drawerTitle").textContent = "Historical Monuments (17)";
    } else if (tab === "gallery") {
      tabGalleryBtn.click();
      document.getElementById("drawerTitle").textContent = `Geotagged Gallery (${state.filteredItems.length})`;
    } else if (tab === "filter") {
      document.getElementById("drawerTitle").textContent = "Filter Atlas";
      document.getElementById("filterSection").scrollIntoView({ behavior: "smooth" });
    }
  }

  function closeMobileDrawer() {
    sidebarDrawer.classList.remove("drawer-open");
    updateMobileNav("map");
  }

  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener("click", closeMobileDrawer);
  }

  function updateMobileNav(tabName) {
    state.activeMobileNav = tabName;
    document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-nav") === tabName);
    });
  }

  document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const navTarget = btn.getAttribute("data-nav");
      updateMobileNav(navTarget);

      if (navTarget === "map") {
        sidebarDrawer.classList.remove("drawer-open");
        document.getElementById("timelineDock").classList.remove("mobile-active");
      } else if (navTarget === "monuments") {
        openMobileDrawer("monuments");
      } else if (navTarget === "gallery") {
        openMobileDrawer("gallery");
      } else if (navTarget === "walk") {
        sidebarDrawer.classList.remove("drawer-open");
        document.getElementById("timelineDock").classList.add("mobile-active");
        if (!state.isPlaying) {
          startPlayback();
        }
      } else if (navTarget === "filter") {
        openMobileDrawer("filter");
      }
    });
  });

  // =========================================
  // MOBILE LAYERS MODAL
  // =========================================
  const mobileLayersModal = document.getElementById("mobileLayersModal");
  const mobileLayersBtn = document.getElementById("mobileLayersBtn");
  const mobileFitBtn = document.getElementById("mobileFitBtn");

  if (mobileLayersBtn) {
    mobileLayersBtn.addEventListener("click", () => {
      if (mobileLayersModal) {
        mobileLayersModal.showModal();
      }
    });
  }

  if (mobileFitBtn) {
    mobileFitBtn.addEventListener("click", () => {
      selectLandmark("all", true);
    });
  }

  const sheetFitKhivaBtn = document.getElementById("sheetFitKhivaBtn");
  if (sheetFitKhivaBtn) {
    sheetFitKhivaBtn.addEventListener("click", () => {
      mobileLayersModal.close();
      selectLandmark("all", true);
    });
  }

  // Base Map Switcher in Sheet & Desktop
  function switchBasemap(name) {
    state.currentBasemap = name;
    Object.values(baseLayers).forEach((lyr) => map.removeLayer(lyr));
    baseLayers[name].addTo(map);

    document.querySelectorAll("[data-basemap], [data-sheet-basemap]").forEach((b) => {
      const val = b.getAttribute("data-basemap") || b.getAttribute("data-sheet-basemap");
      b.classList.toggle("active", val === name);
    });
  }

  document.querySelectorAll("[data-basemap]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchBasemap(btn.getAttribute("data-basemap"));
    });
  });

  document.querySelectorAll("[data-sheet-basemap]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchBasemap(btn.getAttribute("data-sheet-basemap"));
    });
  });

  // Layer switches in Sheet
  function bindCheckbox(id, key, layerGetter) {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.addEventListener("change", (e) => {
      state.layersVisible[key] = e.target.checked;
      const lyr = layerGetter();
      if (!lyr) return;
      if (e.target.checked) {
        map.addLayer(lyr);
      } else {
        map.removeLayer(lyr);
      }
      // sync desktop button
      const deskBtn = document.getElementById({
        clusters: "toggleClustersBtn",
        landmarks: "toggleLandmarksBtn",
        walls: "toggleWallsBtn",
        path: "togglePathBtn",
        heat: "toggleHeatBtn",
      }[key]);
      if (deskBtn) deskBtn.classList.toggle("active", e.target.checked);
    });
  }

  bindCheckbox("sheetCheckPins", "clusters", () => clusterGroup);
  bindCheckbox("sheetCheckLabels", "landmarks", () => landmarksLayer);
  bindCheckbox("sheetCheckWalls", "walls", () => wallsLayer);
  bindCheckbox("sheetCheckRoute", "path", () => pathLayer);
  bindCheckbox("sheetCheckHeat", "heat", () => heatLayer);

  // Desktop Layer Buttons
  function bindDesktopLayerToggle(btnId, key, sheetCbId, layerGetter) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener("click", () => {
      state.layersVisible[key] = !state.layersVisible[key];
      btn.classList.toggle("active", state.layersVisible[key]);
      const cb = document.getElementById(sheetCbId);
      if (cb) cb.checked = state.layersVisible[key];
      const lyr = layerGetter();
      if (!lyr) return;
      if (state.layersVisible[key]) {
        map.addLayer(lyr);
      } else {
        map.removeLayer(lyr);
      }
    });
  }

  bindDesktopLayerToggle("toggleClustersBtn", "clusters", "sheetCheckPins", () => clusterGroup);
  bindDesktopLayerToggle("toggleLandmarksBtn", "landmarks", "sheetCheckLabels", () => landmarksLayer);
  bindDesktopLayerToggle("toggleWallsBtn", "walls", "sheetCheckWalls", () => wallsLayer);
  bindDesktopLayerToggle("togglePathBtn", "path", "sheetCheckRoute", () => pathLayer);
  bindDesktopLayerToggle("toggleHeatBtn", "heat", "sheetCheckHeat", () => heatLayer);

  document.getElementById("resetViewBtn").addEventListener("click", () => {
    selectLandmark("all", true);
  });

  // Filter Listeners
  landmarkSelect.addEventListener("change", (e) => {
    selectLandmark(e.target.value, true);
  });

  document.getElementById("closeBannerBtn").addEventListener("click", () => {
    selectLandmark("all", true);
  });

  document.getElementById("cameraSelect").addEventListener("change", (e) => {
    state.camera = e.target.value;
    applyFilters();
  });

  document.querySelectorAll("[data-filter-time]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-filter-time]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.timeFilter = btn.getAttribute("data-filter-time");
      applyFilters();
    });
  });

  // Sidebar Tab Switching
  const tabLandmarksBtn = document.getElementById("tabLandmarksBtn");
  const tabGalleryBtn = document.getElementById("tabGalleryBtn");
  const landmarksView = document.getElementById("landmarksView");
  const galleryView = document.getElementById("galleryView");

  tabLandmarksBtn.addEventListener("click", () => {
    tabLandmarksBtn.classList.add("active");
    tabGalleryBtn.classList.remove("active");
    landmarksView.style.display = "flex";
    galleryView.style.display = "none";
  });

  tabGalleryBtn.addEventListener("click", () => {
    tabGalleryBtn.classList.add("active");
    tabLandmarksBtn.classList.remove("active");
    galleryView.style.display = "grid";
    landmarksView.style.display = "none";
  });

  // Initial Render
  renderLandmarkMarkers();
  applyFilters();
})();

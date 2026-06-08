/**
 * Main Application Controller
 * Manages UI events, drag-and-drop loading, flight playback,
 * MapLibre maps rendering, and sidebar filter synchronizations.
 */

// Global State
const state = {
    tracks: [],          // Array of parsed flight tracks
    activeTrackId: null, // ID of currently active track
    filters: {
        search: '',
        minDistance: 0
    },
    playback: {
        playing: false,
        speed: 10,       // playback speed multiplier (1x, 5x, 10x, 20x, 50x)
        currentIdx: 0,
        timer: null,
        marker: null,
        follow: true     // Keep map centered on glider during play
    },
    nextId: 1
};

// Colors for overlaying tracks on the map - expanded to 20 colors for maximum variety
const TRACK_COLORS = [
    '#6366f1', // Indigo
    '#10b981', // Emerald
    '#0ea5e9', // Sky Blue
    '#f59e0b', // Amber/Gold
    '#ec4899', // Pink
    '#8b5cf6', // Violet
    '#f97316', // Orange
    '#14b8a6', // Teal
    '#38bdf8', // Light Blue
    '#a3e635', // Lime
    '#ef4444', // Red
    '#f43f5e', // Rose
    '#84cc16', // Lime-Green
    '#06b6d4', // Cyan
    '#d946ef', // Fuchsia
    '#65a30d', // Olive
    '#2563eb', // Royal Blue
    '#ea580c', // Dark Orange
    '#4f46e5', // Deep Indigo
    '#16a34a'  // Forest Green
];

let map = null;
let isMapLoaded = false;
let mapLoadQueue = [];
let altitudeChart = null;
let hoverMarker = null;

// Helper to safely execute map-dependent operations once the style/canvas is ready
function runWhenMapLoaded(fn) {
    if (isMapLoaded) {
        fn();
    } else {
        mapLoadQueue.push(fn);
    }
}

// Initialize Application once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Restore theme from localStorage
    const savedTheme = localStorage.getItem('myway_theme');
    const isDark = savedTheme === 'dark';
    if (isDark) {
        document.body.classList.add('dark-theme');
    }

    initMap();
    initUI();
    loadStoredTracks(); // Load persisted flights from database
});

// --- Map Initialization ---

function initMap() {
    let center = [11.78, 45.81]; // Default center Bassano del Grappa area
    let zoom = 10;

    try {
        const storedCenter = localStorage.getItem('myway_map_center');
        const storedZoom = localStorage.getItem('myway_map_zoom');
        if (storedCenter) {
            center = JSON.parse(storedCenter);
        }
        if (storedZoom) {
            zoom = parseFloat(storedZoom);
        }
    } catch (e) {
        console.error('Failed to load map position from localStorage:', e);
    }

    const isDark = document.body.classList.contains('dark-theme');

    // Initialize MapLibre GL JS with all basemaps pre-defined
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'light-base': {
                    type: 'raster',
                    tiles: ['https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: 'Tiles © CartoDB — Attribution: CartoDB Positron'
                },
                'dark-base': {
                    type: 'raster',
                    tiles: ['https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: 'Tiles © CartoDB — Attribution: CartoDB Dark Matter'
                },
                'hillshade-relief': {
                    type: 'raster',
                    tiles: ['https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],
                    tileSize: 256,
                    attribution: 'Tiles © Esri — Source: Esri World Hillshade'
                }
            },
            layers: [
                {
                    id: 'light-base-layer',
                    type: 'raster',
                    source: 'light-base',
                    minzoom: 0,
                    maxzoom: 20,
                    layout: {
                        visibility: isDark ? 'none' : 'visible'
                    }
                },
                {
                    id: 'dark-base-layer',
                    type: 'raster',
                    source: 'dark-base',
                    minzoom: 0,
                    maxzoom: 20,
                    layout: {
                        visibility: isDark ? 'visible' : 'none'
                    }
                },
                {
                    id: 'hillshade-layer',
                    type: 'raster',
                    source: 'hillshade-relief',
                    minzoom: 0,
                    maxzoom: 20,
                    layout: {
                        visibility: 'visible'
                    },
                    paint: {
                        'raster-opacity': 0.22
                    }
                }
            ]
        },
        center: center,
        zoom: zoom
    });

    // Add navigation controls (zoom, rotate)
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Fire queue when map finishes loading
    map.on('load', () => {
        isMapLoaded = true;
        mapLoadQueue.forEach(fn => fn());
        mapLoadQueue = [];
    });

    // Save map position on move or zoom completion
    map.on('moveend', () => {
        try {
            const currentCenter = map.getCenter();
            const currentZoom = map.getZoom();
            localStorage.setItem('myway_map_center', JSON.stringify([currentCenter.lng, currentCenter.lat]));
            localStorage.setItem('myway_map_zoom', currentZoom.toString());
        } catch (e) {
            console.error('Failed to save map position to localStorage:', e);
        }
    });

    // Register Map Click listener for track line selection (with 8px selection padding/tolerance)
    map.on('click', (e) => {
        const visibleTrackLayers = state.tracks
            .filter(t => t.visible)
            .map(t => `layer-track-${t.id}`);

        if (visibleTrackLayers.length === 0) return;

        // Bounding box for click tolerance (8px padding)
        const bbox = [
            [e.point.x - 8, e.point.y - 8],
            [e.point.x + 8, e.point.y + 8]
        ];

        const features = map.queryRenderedFeatures(bbox, {
            layers: visibleTrackLayers
        });

        if (features.length > 0) {
            // Clicked a track layer
            const layerId = features[0].layer.id;
            const trackId = parseInt(layerId.replace('layer-track-', ''), 10);
            selectTrack(trackId);
        } else {
            // Clicked map background - deselect active track
            deselectTrack();
        }
    });

    // Change cursor on hovering over track lines (with 8px interaction padding/tolerance)
    map.on('mousemove', (e) => {
        const visibleTrackLayers = state.tracks
            .filter(t => t.visible)
            .map(t => `layer-track-${t.id}`);

        if (visibleTrackLayers.length === 0) return;

        const bbox = [
            [e.point.x - 8, e.point.y - 8],
            [e.point.x + 8, e.point.y + 8]
        ];

        const features = map.queryRenderedFeatures(bbox, {
            layers: visibleTrackLayers
        });
        
        map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : '';
    });
}

// --- UI Initialization ---

function initUI() {
    // Mount custom Altitude Chart
    const chartBox = document.getElementById('chart-box');
    altitudeChart = new AltitudeChart(chartBox, {
        onHover: (point) => {
            // Draw a marker on the map corresponding to the chart hover point
            updateHoverMarker(point);
        },
        onHoverEnd: () => {
            removeHoverMarker();
        }
    });

    // Setup Drag and Drop
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');

    uploadZone.addEventListener('click', () => fileInput.click());
    
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileUpload(e.target.files);
        }
    });



    // Setup Clear Tracks
    const btnClearTracks = document.getElementById('btn-clear-tracks');
    btnClearTracks.addEventListener('click', () => {
        clearAllTracks();
    });

    // Search and Filter Listeners
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value.toLowerCase().trim();
        applyFilters();
    });

    const distSlider = document.getElementById('dist-slider');
    const distValue = document.getElementById('dist-value');
    distSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        state.filters.minDistance = val;
        distValue.textContent = val === 0 ? 'All' : `> ${val} km`;
        applyFilters();
    });

    // Sidebar drawer toggle for mobile
    const toggleBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    // Selection Details panel close
    const btnCloseDetails = document.getElementById('btn-close-details');
    btnCloseDetails.addEventListener('click', () => {
        deselectTrack();
    });

    // Replay controls
    const btnPlay = document.getElementById('btn-play');
    btnPlay.addEventListener('click', togglePlayback);

    const btnSpeed = document.getElementById('btn-speed');
    btnSpeed.addEventListener('click', cyclePlaybackSpeed);

    const playbackSlider = document.getElementById('playback-slider');
    playbackSlider.addEventListener('input', (e) => {
        seekPlayback(parseInt(e.target.value, 10));
    });

    const followCheckbox = document.getElementById('follow-glider');
    followCheckbox.addEventListener('change', (e) => {
        state.playback.follow = e.target.checked;
    });

    // Setup Theme Toggle
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
        const isDark = document.body.classList.contains('dark-theme');
        const themeIcon = themeToggleBtn.querySelector('.theme-icon');
        if (themeIcon) {
            themeIcon.setAttribute('data-feather', isDark ? 'sun' : 'moon');
        }
        themeToggleBtn.addEventListener('click', toggleTheme);
    }

    // Convert static icons to SVGs on startup
    feather.replace();
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('myway_theme', isDark ? 'dark' : 'light');

    // Update theme toggle icon
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
        themeToggleBtn.innerHTML = `<i data-feather="${isDark ? 'sun' : 'moon'}" class="theme-icon"></i>`;
        feather.replace();
    }

    // Update map style if map is initialized and loaded
    updateMapTheme(isDark);
}

function updateMapTheme(isDark) {
    if (!map || !isMapLoaded) return;
    
    // Switch visibility of map layers
    map.setLayoutProperty('light-base-layer', 'visibility', isDark ? 'none' : 'visible');
    map.setLayoutProperty('dark-base-layer', 'visibility', isDark ? 'visible' : 'none');
}



// --- File Upload Processing ---

async function handleFileUpload(fileList) {
    const loaderContainer = document.getElementById('loader-container');
    const loaderText = document.getElementById('loader-text');
    const progressFill = document.getElementById('progress-bar-fill');

    loaderContainer.style.display = 'flex';
    
    const parsedTracks = [];
    const totalFiles = fileList.length;

    for (let i = 0; i < totalFiles; i++) {
        const file = fileList[i];
        
        // Basic check for text/IGC files (case-insensitive)
        const nameLower = file.name.toLowerCase();
        if (!nameLower.endsWith('.igc') && !nameLower.endsWith('.txt')) {
            continue; 
        }

        loaderText.textContent = `Parsing ${file.name} (${i + 1}/${totalFiles})...`;
        const percentage = Math.round(((i + 1) / totalFiles) * 100);
        progressFill.style.width = `${percentage}%`;

        try {
            const text = await readFileText(file);
            const parsed = IGCParser.parse(text, file.name);
            if (parsed.points && parsed.points.length > 0) {
                parsedTracks.push(parsed);
            }
        } catch (err) {
            console.error('Failed to parse file:', file.name, err);
        }

        // Yield execution to the browser to keep UI painting fluid
        await new Promise(resolve => requestAnimationFrame(resolve));
    }

    loaderContainer.style.display = 'none';

    if (parsedTracks.length > 0) {
        addTracks(parsedTracks);
    }
}

function readFileText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

// --- Tracks Management ---

function getTrackFingerprint(track) {
    if (!track.points || track.points.length === 0) return '';
    const startPt = track.points[0];
    return `${track.date}_${startPt.timeSec}_${track.stats.duration}_${track.stats.distance}`;
}

function addTracks(newTracks) {
    const existingFingerprints = new Set(state.tracks.map(t => getTrackFingerprint(t)));
    const existingFilenames = new Set(state.tracks.map(t => t.filename.toLowerCase()));

    let addedCount = 0;
    let skippedCount = 0;

    newTracks.forEach(track => {
        const fingerprint = getTrackFingerprint(track);
        const filenameLower = track.filename.toLowerCase();

        // Deduplication based on filename or telemetry fingerprint
        if (existingFingerprints.has(fingerprint) || existingFilenames.has(filenameLower)) {
            skippedCount++;
            return; 
        }

        // Add to sets to prevent duplicates within this batch itself
        existingFingerprints.add(fingerprint);
        existingFilenames.add(filenameLower);

        // Assign color and id
        track.id = state.nextId++;
        track.color = TRACK_COLORS[(track.id - 1) % TRACK_COLORS.length];
        track.visible = true;
        
        state.tracks.push(track);
        drawTrackOnMap(track);

        // Persist parsed track to local database (IndexedDB)
        StorageManager.saveTrack(track).catch(err => {
            console.error('Failed to save track to IndexedDB:', err);
        });

        addedCount++;
    });

    if (skippedCount > 0) {
        showToast(`Added ${addedCount} track${addedCount !== 1 ? 's' : ''}. Skipped ${skippedCount} duplicate${skippedCount !== 1 ? 's' : ''}.`);
    } else if (addedCount > 0) {
        showToast(`Loaded ${addedCount} track${addedCount !== 1 ? 's' : ''}.`);
    }

    if (addedCount > 0) {
        optimizeTrackColors();
        updateDistanceSliderRange();
    }

    renderTrackList();
    applyFilters();
    fitMapBoundsToVisibleTracks();
}

function clearAllTracks() {
    deselectTrack();
    
    // Remove all layers and sources from MapLibre
    state.tracks.forEach(track => {
        removeTrackFromMap(track.id);
    });

    state.tracks = [];
    state.nextId = 1;

    // Clear persisted flights from IndexedDB
    StorageManager.clearAll().then(() => {
        showToast('All flights cleared from storage.');
    }).catch(err => {
        console.error('Failed to clear database:', err);
    });
    
    updateDistanceSliderRange();
    renderTrackList();
    applyFilters();
}

function removeTrackFromMap(id) {
    runWhenMapLoaded(() => {
        const layerId = `layer-track-${id}`;
        const sourceId = `source-track-${id}`;
        
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
        }
    });
}

// --- Map Drawing logic ---

function drawTrackOnMap(track) {
    runWhenMapLoaded(() => {
        const sourceId = `source-track-${track.id}`;
        const layerId = `layer-track-${track.id}`;

        // Transform points to GeoJSON coordinates [lng, lat]
        const coordinates = track.points.map(p => [p.lng, p.lat]);

        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'Feature',
                properties: {
                    id: track.id,
                    filename: track.filename,
                    color: track.color
                },
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates
                }
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': track.color,
                'line-width': 3.0,
                'line-opacity': 0.65
            }
        });
    });
}

function optimizeTrackColors() {
    const N = state.tracks.length;
    if (N === 0) return;

    // 1. Pre-calculate bounding boxes and 10-point downsampled representations for fast distance checks
    const representations = state.tracks.map(track => {
        const bbox = {
            minLng: Infinity, maxLng: -Infinity,
            minLat: Infinity, maxLat: -Infinity
        };
        track.points.forEach(p => {
            if (p.lng < bbox.minLng) bbox.minLng = p.lng;
            if (p.lng > bbox.maxLng) bbox.maxLng = p.lng;
            if (p.lat < bbox.minLat) bbox.minLat = p.lat;
            if (p.lat > bbox.maxLat) bbox.maxLat = p.lat;
        });

        // Downsample to 10 points
        const step = Math.max(1, Math.floor(track.points.length / 10));
        const pts = [];
        for (let i = 0; i < track.points.length; i += step) {
            pts.push(track.points[i]);
        }
        if (pts.length > 0 && pts[pts.length - 1] !== track.points[track.points.length - 1]) {
            pts.push(track.points[track.points.length - 1]);
        }

        return { id: track.id, bbox, pts };
    });

    // 2. Build adjacency list of overlaps (conflicts)
    const adjacency = {};
    state.tracks.forEach(t => adjacency[t.id] = new Set());

    for (let i = 0; i < N; i++) {
        const repA = representations[i];
        for (let j = i + 1; j < N; j++) {
            const repB = representations[j];

            // Quick reject: Bounding boxes do not overlap
            const bboxOverlap = !(
                repA.bbox.maxLng < repB.bbox.minLng ||
                repA.bbox.minLng > repB.bbox.maxLng ||
                repA.bbox.maxLat < repB.bbox.minLat ||
                repA.bbox.minLat > repB.bbox.maxLat
            );

            if (!bboxOverlap) continue;

            // Bounding boxes overlap, check distance between downsampled points
            let isClose = false;
            for (let pA = 0; pA < repA.pts.length; pA++) {
                const ptA = repA.pts[pA];
                for (let pB = 0; pB < repB.pts.length; pB++) {
                    const ptB = repB.pts[pB];
                    // Fast Euclidean squared-distance check (approx. 3km threshold)
                    const dLng = ptA.lng - ptB.lng;
                    const dLat = ptA.lat - ptB.lat;
                    if (dLng * dLng + dLat * dLat < 0.001) {
                        isClose = true;
                        break;
                    }
                }
                if (isClose) break;
            }

            if (isClose) {
                adjacency[repA.id].add(repB.id);
                adjacency[repB.id].add(repA.id);
            }
        }
    }

    // 3. Greedy coloring
    // Sort tracks by degree (number of conflicts) descending to color the most constrained tracks first
    const sortedTrackIds = state.tracks
        .map(t => t.id)
        .sort((idA, idB) => adjacency[idB].size - adjacency[idA].size);

    const colorsAssigned = {}; // id -> color hex

    sortedTrackIds.forEach(id => {
        // Find colors used by neighbors
        const neighborColors = new Set();
        adjacency[id].forEach(neighborId => {
            if (colorsAssigned[neighborId]) {
                neighborColors.add(colorsAssigned[neighborId]);
            }
        });

        // Assign the first color in TRACK_COLORS that is not used by any neighbor
        let assignedColor = null;
        for (let c = 0; c < TRACK_COLORS.length; c++) {
            const color = TRACK_COLORS[c];
            if (!neighborColors.has(color)) {
                assignedColor = color;
                break;
            }
        }

        // Fallback: if all colors are used, pick the least used color among neighbors
        if (!assignedColor) {
            const colorUsageCounts = {};
            TRACK_COLORS.forEach(c => colorUsageCounts[c] = 0);
            adjacency[id].forEach(neighborId => {
                const c = colorsAssigned[neighborId];
                if (c) colorUsageCounts[c]++;
            });
            // Pick color with minimum usage among neighbors
            assignedColor = TRACK_COLORS.reduce((minColor, color) => {
                return colorUsageCounts[color] < colorUsageCounts[minColor] ? color : minColor;
            }, TRACK_COLORS[0]);
        }

        colorsAssigned[id] = assignedColor;
    });

    // 4. Update track colors in state and map layers
    state.tracks.forEach(track => {
        const newColor = colorsAssigned[track.id];
        if (track.color !== newColor) {
            track.color = newColor;
            
            // Update map layer color if it exists
            const layerId = `layer-track-${track.id}`;
            if (map && map.getLayer(layerId)) {
                map.setPaintProperty(layerId, 'line-color', newColor);
            }
            
            // Save updated track to IndexedDB
            StorageManager.saveTrack(track).catch(err => {
                console.error('Failed to save re-colored track:', err);
            });
        }
    });
}

function fitMapBoundsToVisibleTracks() {
    const visibleTracks = state.tracks.filter(t => t.visible);
    if (visibleTracks.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    visibleTracks.forEach(track => {
        track.points.forEach(pt => {
            bounds.extend([pt.lng, pt.lat]);
        });
    });

    map.fitBounds(bounds, {
        padding: { top: 50, bottom: 50, left: 450, right: 50 }, // Padding accounts for sidebar width
        maxZoom: 14,
        duration: 1200
    });
}

// --- Track Selection ---

function selectTrack(trackId) {
    if (state.activeTrackId === trackId) return;

    // Reset old active track line styling
    if (state.activeTrackId !== null) {
        setTrackLineHighlight(state.activeTrackId, false);
    }

    state.activeTrackId = trackId;
    const track = state.tracks.find(t => t.id === trackId);
    
    if (!track) return;

    // Highlight current line on map
    setTrackLineHighlight(trackId, true);

    // Zoom map to track boundaries
    const bounds = new maplibregl.LngLatBounds();
    track.points.forEach(pt => bounds.extend([pt.lng, pt.lat]));
    map.fitBounds(bounds, {
        padding: { top: 60, bottom: 60, left: 440, right: 60 },
        maxZoom: 13,
        duration: 1000
    });

    // Populate Sidebar Details Panel
    document.getElementById('detail-title').textContent = track.pilot;
    document.getElementById('detail-subtitle').textContent = track.glider;
    
    // Set paragliding distance stats
    document.getElementById('stat-xc-points').innerHTML = `${track.stats.xcontestPoints || 0.0} <span>pts</span>`;
    document.getElementById('stat-xc-type').textContent = track.stats.xcontestType || 'Open Distance';
    document.getElementById('stat-five-point').innerHTML = `${track.stats.fivePoint} <span>km</span>`;
    document.getElementById('stat-fai').innerHTML = track.stats.faiTriangle > 0 
        ? `${track.stats.faiTriangle} <span>km</span>` 
        : `None`;
    document.getElementById('stat-flat-fai').innerHTML = track.stats.flatTriangle > 0 
        ? `${track.stats.flatTriangle} <span>km</span>` 
        : `None`;
    document.getElementById('stat-two-point').innerHTML = `${track.stats.twoPoint} <span>km</span>`;
    document.getElementById('stat-dist').innerHTML = `${track.stats.tracklogLength} <span>km</span>`;
    
    document.getElementById('stat-duration').innerHTML = `${formatDuration(track.stats.duration)}`;
    document.getElementById('stat-max-alt').innerHTML = `${track.stats.maxAlt} <span>m</span>`;
    document.getElementById('stat-climb-sink').innerHTML = `+${track.stats.maxClimb} / ${track.stats.maxSink} <span>m/s</span>`;
    document.getElementById('stat-speed').innerHTML = `${track.stats.maxSpeed} / ${track.stats.avgSpeed} <span>km/h</span>`;

    // Populate chart
    altitudeChart.setData(track.points);

    // Reset and mount Playback marker
    resetPlayback();

    // Draw optimal scoring overlay details on map if present
    drawScoringOverlay(track);

    // Show details panel
    const detailPanel = document.getElementById('detail-panel');
    detailPanel.classList.add('open');

    // Highlight active card in sidebar list
    updateActiveSidebarCard();
}

function deselectTrack() {
    if (state.activeTrackId === null) return;
    
    setTrackLineHighlight(state.activeTrackId, false);
    state.activeTrackId = null;
    
    // Close Details Panel
    const detailPanel = document.getElementById('detail-panel');
    detailPanel.classList.remove('open');

    // Stop and clear playback elements
    stopPlayback();
    removePlaybackMarker();

    // Clear optimal scoring overlay visuals from map
    removeScoringOverlay();

    // Remove active card styling
    updateActiveSidebarCard();

    // Close popups
    const popups = document.getElementsByClassName('maplibregl-popup');
    while (popups[0]) {
        popups[0].remove();
    }
}

function setTrackLineHighlight(trackId, isHighlighted) {
    const layerId = `layer-track-${trackId}`;
    if (!map.getLayer(layerId)) return;

    if (isHighlighted) {
        map.setPaintProperty(layerId, 'line-width', 5);
        map.setPaintProperty(layerId, 'line-opacity', 0.95);
        
        // Move highlighted line layer to top of rendering stack
        map.moveLayer(layerId);
    } else {
        const track = state.tracks.find(t => t.id === trackId);
        const color = track ? track.color : TRACK_COLORS[0];
        map.setPaintProperty(layerId, 'line-width', 3.0);
        map.setPaintProperty(layerId, 'line-opacity', 0.65);
    }
}

function updateActiveSidebarCard() {
    const cards = document.querySelectorAll('.track-card');
    cards.forEach(card => {
        const cardId = parseInt(card.dataset.id, 10);
        if (cardId === state.activeTrackId) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });
}



// --- Filters application ---

function applyFilters() {
    const listContainer = document.getElementById('track-list');
    const noTracksState = document.getElementById('no-tracks-state');
    
    let visibleCount = 0;

    state.tracks.forEach(track => {
        const matchesSearch = track.pilot.toLowerCase().includes(state.filters.search) || 
                              track.glider.toLowerCase().includes(state.filters.search) ||
                              track.filename.toLowerCase().includes(state.filters.search);
        
        // Filter by 5-point distance instead of tracklog length
        const matchesDistance = track.stats.fivePoint >= state.filters.minDistance;
        const isVisible = matchesSearch && matchesDistance;

        track.visible = isVisible;

        // Toggle layer on MapLibre
        const layerId = `layer-track-${track.id}`;
        if (map.getLayer(layerId)) {
            map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
        }

        // Toggle card item in list
        const card = document.querySelector(`.track-card[data-id="${track.id}"]`);
        if (card) {
            card.style.display = isVisible ? 'flex' : 'none';
        }

        if (isVisible) {
            visibleCount++;
        }
    });

    // Update track badges
    document.getElementById('total-track-count').textContent = state.tracks.length;
    document.getElementById('filtered-track-count').textContent = visibleCount;

    if (visibleCount === 0 && state.tracks.length > 0) {
        noTracksState.style.display = 'flex';
        noTracksState.querySelector('p').textContent = 'No tracks match current filters.';
    } else if (state.tracks.length === 0) {
        noTracksState.style.display = 'flex';
        noTracksState.querySelector('p').textContent = 'No tracks loaded yet. Drag and drop IGC files or load demos.';
    } else {
        noTracksState.style.display = 'none';
    }

    // If active track was hidden by filters, deselect it
    if (state.activeTrackId !== null) {
        const activeTrack = state.tracks.find(t => t.id === state.activeTrackId);
        if (activeTrack && !activeTrack.visible) {
            deselectTrack();
        }
    }
}

function updateDistanceSliderRange() {
    const slider = document.getElementById('dist-slider');
    if (!slider) return;

    if (state.tracks.length === 0) {
        slider.max = 50;
        slider.value = 0;
        state.filters.minDistance = 0;
        document.getElementById('dist-value').textContent = 'All';
        return;
    }

    const maxFivePoint = Math.max(...state.tracks.map(t => t.stats.fivePoint), 0);
    // Round up to the next multiple of 10, with a minimum of 50
    const newMax = Math.max(50, Math.ceil(maxFivePoint / 10) * 10);
    slider.max = newMax;
}

// --- Sidebar Renderers ---

function renderTrackList() {
    const listContainer = document.getElementById('track-list');
    
    // Clear list but retain no-tracks placeholder element
    const placeholder = document.getElementById('no-tracks-state');
    listContainer.innerHTML = '';
    listContainer.appendChild(placeholder);

    state.tracks.forEach(track => {
        const card = document.createElement('div');
        card.className = 'track-card';
        card.dataset.id = track.id;
        card.style.setProperty('--track-color', track.color);
        
        if (state.activeTrackId === track.id) {
            card.classList.add('active');
        }

        // Format duration for list
        const hr = Math.floor(track.stats.duration / 3600);
        const min = Math.floor((track.stats.duration % 3600) / 60);
        const durationStr = hr > 0 ? `${hr}h ${min}m` : `${min}m`;

        card.innerHTML = `
            <div class="track-card-header">
                <span class="track-card-title" title="${track.filename}">${track.filename}</span>
                <div style="display:flex; align-items:center; gap:0.5rem">
                    <span class="track-card-date">${track.date}</span>
                    <button class="delete-btn" data-id="${track.id}" title="Delete Flight">🗑</button>
                </div>
            </div>
            <div class="track-card-meta" style="display:flex; justify-content:space-between; align-items:center">
                <div style="display:flex; gap:0.75rem">
                    <div class="track-meta-item">
                        <span>Pilot:</span>
                        <span class="metric" style="max-width:85px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${track.pilot}</span>
                    </div>
                    <div class="track-meta-item">
                        <span>Points:</span>
                        <span class="metric" style="font-weight:700; color:var(--color-primary)">${track.stats.xcontestPoints || 0.0} pts</span>
                    </div>
                </div>
                <div class="track-meta-item" style="margin-left:auto">
                    <span>Time:</span>
                    <span class="metric">${durationStr}</span>
                </div>
            </div>
            <div style="display:flex; align-items:center; margin-top:4px; font-size:0.75rem; color:var(--color-text-muted)">
                <span style="background:rgba(79, 70, 229, 0.08); color:var(--color-primary); font-weight:600; padding:1px 5px; border-radius:4px; display:inline-flex; align-items:center; gap:3px">
                    ${(track.stats.xcontestType || 'Open Distance') === 'FAI Triangle' ? `▲ FAI Triangle: ${track.stats.faiTriangle} km` : 
                      (track.stats.xcontestType || 'Open Distance') === 'Flat Triangle' ? `▲ Flat Triangle: ${track.stats.flatTriangle} km` : 
                      `➔ Open Distance: ${track.stats.fivePoint} km`}
                </span>
            </div>
        `;

        // Card selection trigger
        card.addEventListener('click', () => {
            selectTrack(track.id);
        });

        // Card delete trigger (prevent selecting card)
        const deleteBtn = card.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSingleTrack(track.id);
        });

        listContainer.appendChild(card);
    });
}

// --- HUD Flight Simulation / Playback ---

function resetPlayback() {
    stopPlayback();
    state.playback.currentIdx = 0;
    
    const track = state.tracks.find(t => t.id === state.activeTrackId);
    if (!track) return;

    // Set Slider bounds
    const slider = document.getElementById('playback-slider');
    slider.min = 0;
    slider.max = track.points.length - 1;
    slider.value = 0;

    // Reset Play button icon (Feather play icon)
    document.getElementById('btn-play').innerHTML = `<i data-feather="play"></i>`;
    feather.replace();

    // Place Replay Marker on map
    createPlaybackMarker(track.points[0], track.color);
    updateHUD(track.points[0], 0);
}

function createPlaybackMarker(point, color) {
    removePlaybackMarker();

    const el = document.createElement('div');
    el.className = 'flight-glider-marker';
    el.style.width = '18px';
    el.style.height = '18px';
    el.style.borderRadius = '50%';
    el.style.backgroundColor = color;
    el.style.border = '3px solid white';
    el.style.boxShadow = '0 0 10px rgba(0,0,0,0.6)';
    
    // Add pulsing radar effect
    const pulse = document.createElement('div');
    pulse.style.position = 'absolute';
    pulse.style.top = '-6px';
    pulse.style.left = '-6px';
    pulse.style.width = '24px';
    pulse.style.height = '24px';
    pulse.style.borderRadius = '50%';
    pulse.style.border = `2px solid ${color}`;
    pulse.style.animation = 'pulse 1.8s infinite ease-out';
    
    // Inject animation styling locally
    if (!document.getElementById('pulse-anim')) {
        const style = document.createElement('style');
        style.id = 'pulse-anim';
        style.innerHTML = `
            @keyframes pulse {
                0% { transform: scale(0.6); opacity: 1; }
                100% { transform: scale(2.2); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    el.appendChild(pulse);

    state.playback.marker = new maplibregl.Marker({ element: el })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
}

function removePlaybackMarker() {
    if (state.playback.marker) {
        state.playback.marker.remove();
        state.playback.marker = null;
    }
}

function togglePlayback() {
    if (state.playback.playing) {
        stopPlayback();
    } else {
        startPlayback();
    }
}

function startPlayback() {
    const track = state.tracks.find(t => t.id === state.activeTrackId);
    if (!track) return;

    state.playback.playing = true;
    document.getElementById('btn-play').innerHTML = `<i data-feather="pause"></i>`;
    feather.replace();

    // Playback loop
    const stepTime = 100; // loop interval in ms (10 frames per sec)
    
    state.playback.timer = setInterval(() => {
        // Increment index based on speed multiplier
        // Speed multipliers: 10x means index advances by 1 per frame (since track is recorded every 2s, 10x speed means 10 * 2 = 20s of flight per second)
        // Adjust index advance:
        const indexIncrement = Math.max(1, Math.floor(state.playback.speed / 2));
        state.playback.currentIdx += indexIncrement;

        if (state.playback.currentIdx >= track.points.length) {
            // Reached end of flight path
            resetPlayback();
        } else {
            const point = track.points[state.playback.currentIdx];
            updatePlaybackFrame(point, state.playback.currentIdx);
        }
    }, stepTime);
}

function stopPlayback() {
    state.playback.playing = false;
    if (state.playback.timer) {
        clearInterval(state.playback.timer);
        state.playback.timer = null;
    }
    const btn = document.getElementById('btn-play');
    if (btn) {
        btn.innerHTML = `<i data-feather="play"></i>`;
        feather.replace();
    }
}

function seekPlayback(index) {
    const track = state.tracks.find(t => t.id === state.activeTrackId);
    if (!track) return;

    state.playback.currentIdx = Math.min(track.points.length - 1, Math.max(0, index));
    const point = track.points[state.playback.currentIdx];
    
    updatePlaybackFrame(point, state.playback.currentIdx);
}

function cyclePlaybackSpeed() {
    const speeds = [5, 10, 25, 50, 100];
    const currentSpeed = state.playback.speed;
    const nextIdx = (speeds.indexOf(currentSpeed) + 1) % speeds.length;
    
    state.playback.speed = speeds[nextIdx];
    document.getElementById('btn-speed').textContent = `${state.playback.speed}x`;

    // Restart timer loop with new speed if currently playing
    if (state.playback.playing) {
        stopPlayback();
        startPlayback();
    }
}

function updatePlaybackFrame(point, index) {
    // Update marker location
    if (state.playback.marker) {
        state.playback.marker.setLngLat([point.lng, point.lat]);
    }

    // Move slider handle
    const slider = document.getElementById('playback-slider');
    slider.value = index;

    // Pan map to follow glider if enabled
    if (state.playback.follow) {
        map.panTo([point.lng, point.lat], { duration: 100 });
    }

    // Update statistics readings
    updateHUD(point, index);
}

function updateHUD(point, index) {
    const track = state.tracks.find(t => t.id === state.activeTrackId);
    if (!track) return;

    // Calculate current speed and climb rate from adjacent points
    let currentSpeed = 0;
    let currentClimb = 0.0;
    
    if (index > 0) {
        const prevPoint = track.points[index - 1];
        const timeDiff = point.timeSec - prevPoint.timeSec;
        if (timeDiff > 0) {
            // Speed (km/h)
            const distM = haversineDistance(prevPoint.lat, prevPoint.lng, point.lat, point.lng);
            currentSpeed = Math.round((distM / timeDiff) * 3.6);
            
            // Climb rate (m/s)
            currentClimb = Math.round(((point.alt - prevPoint.alt) / timeDiff) * 10) / 10;
        }
    }

    // Calculate Glide Ratio (L/D)
    // Paragliding glide ratio = horizontal speed / vertical speed
    // If climb rate is positive, it's infinity (gaining altitude). If negative, it's horizontal/vertical.
    let glideStr = 'Flat';
    if (currentClimb < 0) {
        const horizontalMps = (currentSpeed / 3.6);
        const verticalMps = Math.abs(currentClimb);
        const glide = Math.round((horizontalMps / verticalMps) * 10) / 10;
        glideStr = glide < 99 ? `${glide}` : 'Infinite';
    } else if (currentClimb > 0) {
        glideStr = 'Climb';
    }

    // Update UI Elements
    document.getElementById('hud-alt').textContent = `${point.alt}m`;
    document.getElementById('hud-speed').textContent = `${currentSpeed} km/h`;
    
    const sign = currentClimb > 0 ? '+' : '';
    const climbEl = document.getElementById('hud-climb');
    climbEl.textContent = `${sign}${currentClimb} m/s`;
    
    if (currentClimb > 0) {
        climbEl.style.color = 'var(--color-secondary)';
    } else if (currentClimb < 0) {
        climbEl.style.color = 'var(--color-danger)';
    } else {
        climbEl.style.color = 'var(--color-text-muted)';
    }

    document.getElementById('hud-glide').textContent = glideStr;

    // Elapsed Time String
    const startSec = track.points[0].timeSec;
    let elapsed = point.timeSec - startSec;
    if (elapsed < 0) elapsed += 86400; // wrap midnight

    const hr = Math.floor(elapsed / 3600);
    const min = Math.floor((elapsed % 3600) / 60);
    const sec = elapsed % 60;
    
    const timeStr = [hr, min, sec].map(v => v.toString().padStart(2, '0')).join(':');
    document.getElementById('playback-time').textContent = timeStr;
}

// --- Chart Hover Linkage (Map Synchronization) ---

function updateHoverMarker(point) {
    if (!hoverMarker) {
        const el = document.createElement('div');
        el.className = 'chart-scrub-marker';
        el.style.width = '14px';
        el.style.height = '14px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = 'var(--color-secondary, #10b981)';
        el.style.border = '2px solid white';
        el.style.boxShadow = '0 0 6px rgba(0,0,0,0.6)';
        
        hoverMarker = new maplibregl.Marker({ element: el })
            .setLngLat([point.lng, point.lat])
            .addTo(map);
    } else {
        hoverMarker.setLngLat([point.lng, point.lat]);
    }
}

function removeHoverMarker() {
    if (hoverMarker) {
        hoverMarker.remove();
        hoverMarker = null;
    }
}

// --- Helper Utilities ---

function formatDuration(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    
    return parts.join(' ');
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function showToast(message) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.position = 'fixed';
        container.style.bottom = '24px';
        container.style.right = '24px';
        container.style.zIndex = '9999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.background = 'var(--color-bg-panel, rgba(255, 255, 255, 0.9))';
    toast.style.color = 'var(--color-text-main, #0f172a)';
    toast.style.border = '1px solid var(--border-color-active, rgba(79, 70, 229, 0.3))';
    toast.style.padding = '0.75rem 1.25rem';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = 'var(--shadow-main, 0 10px 25px -5px rgba(0,0,0,0.1))';
    toast.style.fontSize = '0.85rem';
    toast.style.fontFamily = 'var(--font-ui, sans-serif)';
    toast.style.fontWeight = '600';
    toast.style.opacity = '0';
    toast.style.transition = 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
    toast.style.transform = 'translateY(20px)';
    
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger animate-in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    // Animate-out and clean up
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            toast.remove();
        }, 350);
    }, 3800);
}

// --- Dynamic Scoring Map Overlay Visualizers ---

function drawScoringOverlay(track) {
    removeScoringOverlay(); // Clear previous overlay elements
    
    if (!track || !track.stats) return;

    const stats = track.stats;
    const scoringType = stats.xcontestType || 'Open Distance';
    
    let coordinates = [];
    let tps = [];
    let overlayColor = 'var(--color-primary, #4f46e5)';

    if (scoringType === 'FAI Triangle' && stats.faiDetails) {
        coordinates = [
            stats.faiDetails.tp1,
            stats.faiDetails.tp2,
            stats.faiDetails.tp3,
            stats.faiDetails.tp1 // Close path
        ];
        tps = [
            { coords: stats.faiDetails.tp1, label: 'TP1' },
            { coords: stats.faiDetails.tp2, label: 'TP2' },
            { coords: stats.faiDetails.tp3, label: 'TP3' }
        ];
        overlayColor = '#6366f1'; // Indigo for FAI Triangle
    } else if (scoringType === 'Flat Triangle' && stats.flatDetails) {
        coordinates = [
            stats.flatDetails.tp1,
            stats.flatDetails.tp2,
            stats.flatDetails.tp3,
            stats.flatDetails.tp1 // Close path
        ];
        tps = [
            { coords: stats.flatDetails.tp1, label: 'TP1' },
            { coords: stats.flatDetails.tp2, label: 'TP2' },
            { coords: stats.flatDetails.tp3, label: 'TP3' }
        ];
        overlayColor = '#10b981'; // Emerald for Flat Triangle
    } else if (scoringType === 'Open Distance' && stats.fivePointDetails) {
        coordinates = [
            stats.fivePointDetails.start,
            stats.fivePointDetails.tp1,
            stats.fivePointDetails.tp2,
            stats.fivePointDetails.tp3,
            stats.fivePointDetails.finish
        ];
        tps = [
            { coords: stats.fivePointDetails.start, label: 'S' },
            { coords: stats.fivePointDetails.tp1, label: 'TP1' },
            { coords: stats.fivePointDetails.tp2, label: 'TP2' },
            { coords: stats.fivePointDetails.tp3, label: 'TP3' },
            { coords: stats.fivePointDetails.finish, label: 'F' }
        ];
        overlayColor = '#f59e0b'; // Amber/Gold for Open Distance
    } else {
        return; // Nothing valid to draw
    }

    const sourceId = 'source-scoring-overlay';
    const layerId = 'layer-scoring-overlay';

    map.addSource(sourceId, {
        type: 'geojson',
        data: {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: coordinates
            }
        }
    });

    map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': overlayColor,
            'line-width': 2,
            'line-dasharray': [3, 3] // Dotted line style
        }
    });

    // Create markers for Turnpoints/Start/Finish
    state.scoringMarkers = tps.map(tp => {
        const el = document.createElement('div');
        el.className = 'scoring-tp-marker';
        el.style.background = overlayColor;
        el.style.color = '#ffffff';
        el.style.width = '22px';
        el.style.height = '22px';
        el.style.borderRadius = '50%';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.fontSize = '9px';
        el.style.fontWeight = 'bold';
        el.style.border = '2px solid white';
        el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        el.textContent = tp.label;

        return new maplibregl.Marker({ element: el })
            .setLngLat(tp.coords)
            .addTo(map);
    });
}

function removeScoringOverlay() {
    const layerId = 'layer-scoring-overlay';
    const sourceId = 'source-scoring-overlay';

    if (map && map.getLayer(layerId)) {
        map.removeLayer(layerId);
    }
    if (map && map.getSource(sourceId)) {
        map.removeSource(sourceId);
    }
    if (state.scoringMarkers) {
        state.scoringMarkers.forEach(m => m.remove());
        state.scoringMarkers = null;
    }
}

// --- Persistence Layer loaders ---

async function loadStoredTracks() {
    try {
        const stored = await StorageManager.getAllTracks();
        if (stored && stored.length > 0) {
            // Restore state track counter id
            const maxId = Math.max(...stored.map(t => t.id), 0);
            state.nextId = maxId + 1;

            for (let i = 0; i < stored.length; i++) {
                const track = stored[i];
                let needsResave = false;

                // Upgrade color to the new vibrant high-contrast palette
                const newColor = TRACK_COLORS[(track.id - 1) % TRACK_COLORS.length];
                if (track.color !== newColor) {
                    track.color = newColor;
                    needsResave = true;
                }

                if (!track.stats || track.stats.scoringVersion !== 2) {
                    const xcStats = XCSolver.solve(track.points || []);
                    track.stats = track.stats || {};
                    Object.assign(track.stats, xcStats);
                    needsResave = true;
                }

                if (needsResave) {
                    // Resave updated track to IndexedDB
                    await StorageManager.saveTrack(track).catch(err => {
                        console.error('Failed to save upgraded track:', track.filename, err);
                    });
                }

                track.visible = true;
                state.tracks.push(track);
            }

            // Make sure map is loaded before drawing layers
            runWhenMapLoaded(() => {
                drawStoredTracks();
            });
        }
    } catch (err) {
        console.error('Failed to load stored tracks from database:', err);
    }
}

function drawStoredTracks() {
    state.tracks.forEach(track => {
        drawTrackOnMap(track);
    });
    optimizeTrackColors();
    updateDistanceSliderRange();
    renderTrackList();
    applyFilters();
    
    // Only fit map bounds on startup if there is no stored map position in localStorage
    const hasStoredPosition = localStorage.getItem('myway_map_center');
    if (!hasStoredPosition) {
        fitMapBoundsToVisibleTracks();
    }
}

async function deleteSingleTrack(id) {
    try {
        if (state.activeTrackId === id) {
            deselectTrack();
        }

        // Delete from local database
        await StorageManager.deleteTrack(id);

        // Delete from Map rendering layers
        removeTrackFromMap(id);

        // Delete from local state array
        state.tracks = state.tracks.filter(t => t.id !== id);

        optimizeTrackColors();
        updateDistanceSliderRange();

        renderTrackList();
        applyFilters();
        
        showToast('Flight deleted.');
    } catch (err) {
        console.error('Failed to delete track:', err);
        showToast('Error deleting flight.');
    }
}

// --- IndexedDB Database Storage Manager ---

class StorageManager {
    static openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('MyWayTracksDB', 1);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('tracks')) {
                    db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
                }
            };

            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(request.error);
        });
    }

    static async getAllTracks() {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('tracks', 'readonly');
            const store = transaction.objectStore('tracks');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    static async saveTrack(track) {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('tracks', 'readwrite');
            const store = transaction.objectStore('tracks');
            
            // Serialize only data points and telemetry, removing references to map layers
            const dbTrack = {
                id: track.id,
                filename: track.filename,
                date: track.date,
                pilot: track.pilot,
                glider: track.glider,
                points: track.points,
                stats: track.stats,
                color: track.color
            };

            const request = store.put(dbTrack);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    static async deleteTrack(id) {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('tracks', 'readwrite');
            const store = transaction.objectStore('tracks');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    static async clearAll() {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('tracks', 'readwrite');
            const store = transaction.objectStore('tracks');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

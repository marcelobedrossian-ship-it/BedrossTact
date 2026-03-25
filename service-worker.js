// ==================== SAIL DROID PWA ====================

const STORAGE_WAYPOINTS = 'saildroid_waypoints';
const STORAGE_ROUTE = 'saildroid_route';
const ARRIVAL_RADIUS_METERS = 50;

let currentPosition = null;
let watchId = null;
let waypoints = [];
let activeRoute = [];
let currentRouteIndex = -1;
let currentTargetWpt = null;
let navigationActive = false;
let lastArrivalNotification = null;

const speedEl = document.getElementById('speed');
const courseEl = document.getElementById('course');
const latEl = document.getElementById('lat');
const lonEl = document.getElementById('lon');
const gpsStatusEl = document.getElementById('gpsStatus');
const satellitesEl = document.getElementById('satellites');
const accuracyEl = document.getElementById('accuracy');
const targetNameEl = document.getElementById('targetName');
const targetDistanceEl = document.getElementById('targetDistance');
const progressBar = document.getElementById('progressBar');
const waypointListEl = document.getElementById('waypointList');
const routeInfoDiv = document.getElementById('routeInfo');
const routeListEl = document.getElementById('routeList');
const routeProgressSpan = document.getElementById('routeProgress');
const searchInput = document.getElementById('searchWpt');

document.addEventListener('DOMContentLoaded', () => {
    loadWaypoints();
    renderWaypointList();
    startGPS();
    setupEventListeners();
    updateUI();
});

function setupEventListeners() {
    document.getElementById('addWptBtn').addEventListener('click', addCurrentWaypoint);
    document.getElementById('createRouteBtn').addEventListener('click', createRouteFromSelected);
    document.getElementById('clearRouteBtn').addEventListener('click', clearRoute);
    document.getElementById('stopNavigation').addEventListener('click', stopNavigation);
    searchInput.addEventListener('input', () => renderWaypointList());
}

function startGPS() {
    if (!navigator.geolocation) {
        gpsStatusEl.textContent = '❌ GPS no soportado';
        return;
    }
    
    watchId = navigator.geolocation.watchPosition(
        onPositionUpdate,
        onGPSError,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function onPositionUpdate(position) {
    currentPosition = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        speed: position.coords.speed || 0,
        heading: position.coords.heading || 0,
        accuracy: position.coords.accuracy
    };
    
    const speedKnots = currentPosition.speed * 1.94384;
    speedEl.textContent = speedKnots.toFixed(1);
    courseEl.textContent = currentPosition.heading.toFixed(0) + '°';
    
    latEl.textContent = formatCoord(currentPosition.lat, 'lat');
    lonEl.textContent = formatCoord(currentPosition.lon, 'lon');
    
    gpsStatusEl.textContent = '✅ GPS activo';
    satellitesEl.textContent = position.coords.satellites || '?';
    accuracyEl.textContent = Math.round(currentPosition.accuracy);
    
    updateWaypointDistances();
    
    if (navigationActive && currentTargetWpt) {
        checkArrival();
    }
    
    updateTargetDisplay();
    renderWaypointList();
}

function onGPSError(error) {
    switch(error.code) {
        case error.PERMISSION_DENIED:
            gpsStatusEl.textContent = '❌ Permiso denegado';
            break;
        case error.POSITION_UNAVAILABLE:
            gpsStatusEl.textContent = '❌ Señal GPS no disponible';
            break;
        case error.TIMEOUT:
            gpsStatusEl.textContent = '⏱️ Timeout GPS';
            break;
        default:
            gpsStatusEl.textContent = '❌ Error GPS';
    }
}

function formatCoord(coord, type) {
    const absCoord = Math.abs(coord);
    const degrees = Math.floor(absCoord);
    const minutes = (absCoord - degrees) * 60;
    const direction = type === 'lat' ? (coord >= 0 ? 'N' : 'S') : (coord >= 0 ? 'E' : 'W');
    return `${degrees}° ${minutes.toFixed(3)}' ${direction}`;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
}

function formatDistance(meters) {
    if (meters < 100) {
        return `${Math.round(meters)} m`;
    } else if (meters < 1852) {
        return `${(meters / 1000).toFixed(1)} km`;
    } else {
        const nm = meters / 1852;
        if (nm < 10) return `${nm.toFixed(1)} nm`;
        return `${nm.toFixed(0)} nm`;
    }
}

function formatDistanceForTarget(meters) {
    if (meters < 100) {
        return `${Math.round(meters)} m`;
    } else if (meters < 1852) {
        return `${(meters / 1000).toFixed(1)} km`;
    } else {
        return `${(meters / 1852).toFixed(1)} nm`;
    }
}

function loadWaypoints() {
    const stored = localStorage.getItem(STORAGE_WAYPOINTS);
    if (stored) {
        waypoints = JSON.parse(stored);
    } else {
        waypoints = [];
        saveWaypoints();
    }
}

function saveWaypoints() {
    localStorage.setItem(STORAGE_WAYPOINTS, JSON.stringify(waypoints));
}

function addCurrentWaypoint() {
    if (!currentPosition) {
        alert('Esperando señal GPS...');
        return;
    }
    
    const name = prompt('Nombre del waypoint:', `WPT ${waypoints.length + 1}`);
    if (!name) return;
    
    const newWpt = {
        id: Date.now().toString(),
        name: name,
        lat: currentPosition.lat,
        lon: currentPosition.lon,
        createdAt: Date.now()
    };
    
    waypoints.push(newWpt);
    saveWaypoints();
    renderWaypointList();
}

function deleteWaypoint(id) {
    waypoints = waypoints.filter(w => w.id !== id);
    if (activeRoute.includes(id)) {
        activeRoute = activeRoute.filter(wid => wid !== id);
        saveRoute();
        if (currentTargetWpt && currentTargetWpt.id === id) {
            stopNavigation();
        } else if (activeRoute.length > 0) {
            updateRouteNavigation();
        } else {
            updateRouteDisplay();
        }
    }
    saveWaypoints();
    renderWaypointList();
    updateTargetDisplay();
}

function navigateToWaypoint(wpt) {
    if (!currentPosition) {
        alert('GPS no disponible');
        return;
    }
    
    activeRoute = [];
    saveRoute();
    currentRouteIndex = -1;
    navigationActive = true;
    currentTargetWpt = wpt;
    lastArrivalNotification = null;
    updateTargetDisplay();
    updateRouteDisplay();
}

function updateWaypointDistances() {
    if (!currentPosition) return;
    
    waypoints.forEach(wpt => {
        wpt.distance = calculateDistance(
            currentPosition.lat, currentPosition.lon,
            wpt.lat, wpt.lon
        );
    });
    
    waypoints.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
}

function renderWaypointList() {
    if (!waypointListEl) return;
    
    const searchTerm = searchInput.value.toLowerCase();
    const filteredWpts = waypoints.filter(wpt => 
        wpt.name.toLowerCase().includes(searchTerm)
    );
    
    if (filteredWpts.length === 0) {
        waypointListEl.innerHTML = '<div class="empty-message">📭 No hay waypoints que coincidan</div>';
        return;
    }
    
    waypointListEl.innerHTML = filteredWpts.map(wpt => {
        const distance = wpt.distance ? formatDistance(wpt.distance) : '---';
        const isSelected = activeRoute.includes(wpt.id);
        const isCurrentTarget = currentTargetWpt && currentTargetWpt.id === wpt.id;
        
        return `
            <div class="wpt-item ${isSelected ? 'selected' : ''}" data-id="${wpt.id}">
                <div class="wpt-info">
                    <div class="wpt-name">${escapeHtml(wpt.name)} ${isCurrentTarget ? '🎯' : ''}</div>
                    <div class="wpt-coords">${wpt.lat.toFixed(5)}°, ${wpt.lon.toFixed(5)}°</div>
                </div>
                <div class="wpt-distance">📏 ${distance}</div>
                <div class="wpt-actions">
                    <button class="btn-nav" onclick="navigateToWaypointById('${wpt.id}')" title="Navegar">🧭</button>
                    <button class="btn-select" onclick="toggleSelectForRoute('${wpt.id}')" title="${isSelected ? 'Quitar de ruta' : 'Añadir a ruta'}">${isSelected ? '✓' : '➕'}</button>
                    <button class="btn-delete" onclick="deleteWaypoint('${wpt.id}')" title="Eliminar">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

function navigateToWaypointById(id) {
    const wpt = waypoints.find(w => w.id === id);
    if (wpt) navigateToWaypoint(wpt);
}

function toggleSelectForRoute(id) {
    if (activeRoute.includes(id)) {
        activeRoute = activeRoute.filter(wid => wid !== id);
    } else {
        activeRoute.push(id);
    }
    saveRoute();
    renderWaypointList();
    updateRouteDisplay();
}

function createRouteFromSelected() {
    if (activeRoute.length === 0) {
        alert('Selecciona al menos un waypoint usando el botón "+" en cada waypoint.');
        return;
    }
    
    if (activeRoute.length === 1) {
        const wpt = waypoints.find(w => w.id === activeRoute[0]);
        if (wpt) navigateToWaypoint(wpt);
        return;
    }
    
    startRouteNavigation();
}

function startRouteNavigation() {
    if (activeRoute.length === 0) return;
    
    currentRouteIndex = 0;
    const firstWpt = waypoints.find(w => w.id === activeRoute[0]);
    if (firstWpt) {
        navigationActive = true;
        currentTargetWpt = firstWpt;
        lastArrivalNotification = null;
        updateTargetDisplay();
        updateRouteDisplay();
    }
}

function updateRouteNavigation() {
    if (activeRoute.length === 0) {
        stopNavigation();
        return;
    }
    
    if (currentRouteIndex >= activeRoute.length) {
        alert('🎉 ¡Ruta completada!');
        stopNavigation();
        return;
    }
    
    const nextWpt = waypoints.find(w => w.id === activeRoute[currentRouteIndex]);
    if (nextWpt) {
        currentTargetWpt = nextWpt;
        lastArrivalNotification = null;
        updateTargetDisplay();
        updateRouteDisplay();
    } else {
        currentRouteIndex++;
        updateRouteNavigation();
    }
}

function advanceToNextWaypoint() {
    if (activeRoute.length === 0) return;
    
    currentRouteIndex++;
    updateRouteNavigation();
}

function checkArrival() {
    if (!currentPosition || !currentTargetWpt) return;
    
    const distance = calculateDistance(
        currentPosition.lat, currentPosition.lon,
        currentTargetWpt.lat, currentTargetWpt.lon
    );
    
    if (distance <= ARRIVAL_RADIUS_METERS) {
        const now = Date.now();
        if (lastArrivalNotification && (now - lastArrivalNotification) < 5000) return;
        lastArrivalNotification = now;
        
        playArrivalSound();
        alert(`🎯 ¡Llegaste a ${currentTargetWpt.name}!`);
        
        if (activeRoute.length > 0) {
            advanceToNextWaypoint();
        } else {
            stopNavigation();
        }
    }
}

function playArrivalSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.frequency.value = 880;
        gainNode.gain.value = 0.3;
        
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.5);
        oscillator.stop(audioCtx.currentTime + 0.5);
        
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    } catch(e) {
        console.log('Audio no soportado');
    }
}

function stopNavigation() {
    navigationActive = false;
    currentTargetWpt = null;
    currentRouteIndex = -1;
    activeRoute = [];
    saveRoute();
    updateTargetDisplay();
    updateRouteDisplay();
    renderWaypointList();
}

function clearRoute() {
    activeRoute = [];
    saveRoute();
    if (navigationActive && currentTargetWpt && !activeRoute.length) {
        stopNavigation();
    }
    renderWaypointList();
    updateRouteDisplay();
}

function saveRoute() {
    localStorage.setItem(STORAGE_ROUTE, JSON.stringify(activeRoute));
}

function updateTargetDisplay() {
    if (!navigationActive || !currentTargetWpt || !currentPosition) {
        targetNameEl.textContent = '---';
        targetDistanceEl.textContent = '---';
        progressBar.style.width = '0%';
        return;
    }
    
    const distance = calculateDistance(
        currentPosition.lat, currentPosition.lon,
        currentTargetWpt.lat, currentTargetWpt.lon
    );
    
    targetNameEl.textContent = currentTargetWpt.name;
    targetDistanceEl.textContent = formatDistanceForTarget(distance);
    
    let progress = 0;
    if (distance < 5000) {
        progress = Math.min(100, (5000 - distance) / 5000 * 100);
    }
    progressBar.style.width = `${progress}%`;
}

function updateRouteDisplay() {
    if (activeRoute.length === 0) {
        routeInfoDiv.style.display = 'none';
        return;
    }
    
    routeInfoDiv.style.display = 'block';
    const routeWaypoints = activeRoute.map((id, idx) => {
        const wpt = waypoints.find(w => w.id === id);
        const name = wpt ? wpt.name : '???';
        let statusClass = '';
        if (idx < currentRouteIndex) statusClass = 'completed';
        else if (idx === currentRouteIndex && navigationActive) statusClass = 'active';
        return `<span class="route-wpt ${statusClass}">${name}</span>`;
    }).join(' → ');
    
    routeListEl.innerHTML = routeWaypoints;
    routeProgressSpan.textContent = `${currentRouteIndex + 1}/${activeRoute.length}`;
}

function updateUI() {
    if (currentPosition) {
        updateTargetDisplay();
    }
    requestAnimationFrame(updateUI);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
let is24HourFormat = true;
let currentSettings;
let debounceTimer = null;
let requestId = 0;
let jsonpId = 0;
let activeSuggestions = [];
let selectedIndex = -1;

// just copied from google
function updateClock(clockElement, use24HourFormat) {
  const now = new Date();
  const clockTime = clockElement.querySelector('.clock-time') || clockElement;
  
  if (use24HourFormat) {
    clockTime.textContent = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } else {
    clockTime.textContent = now.toLocaleTimeString('en-US', {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  const modalTime = document.querySelector('.time-panel-current-time');
  const modalDate = document.querySelector('.time-panel-date');
  if (modalTime) modalTime.textContent = now.toLocaleTimeString('en-US', {
    hour12: !use24HourFormat,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  if (modalDate) modalDate.textContent = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
  syncDifferenceOverlays();
}

function switchToImageIfVideoUnsupported() {
  const videoElement = document.querySelector('.bg-video');
  const imageElement = document.querySelector('.bg-image');
  console.log(videoElement, imageElement);
  if (!videoElement.canPlayType) {
    videoElement.style.display = 'none';
    imageElement.style.display = 'block';
  }
}

// ai genarated generalisation of dock
function setupDock(dockElement) {
  let animationFrame;
  const directions = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  function updateDock(pointerPosition) {
    const apps = [...dockElement.querySelectorAll('.bottom-bar-apps .apps')];
    const dockBounds = dockElement.getBoundingClientRect();
    const isVertical = dockElement.classList.contains('is-vertical');
    const direction = directions[dockElement.dataset.popDirection] || directions.up;
    apps.forEach((app) => {
      const appBounds = app.getBoundingClientRect();
      const appCenter = isVertical
        ? appBounds.top - dockBounds.top + appBounds.height / 2
        : appBounds.left - dockBounds.left + appBounds.width / 2;
      const distance = Math.abs(pointerPosition - appCenter);
      const influence = Math.max(0, 1 - distance / 110);
      const easedInfluence = influence * influence * (3 - 2 * influence);
      app.style.setProperty('--dock-scale', (1 + easedInfluence * 0.55).toFixed(3));
      app.style.setProperty('--dock-shift-x', `${(easedInfluence * direction.x * 1.2).toFixed(3)}rem`);
      app.style.setProperty('--dock-shift-y', `${(easedInfluence * direction.y * 1.2).toFixed(3)}rem`);
    });
  }

  dockElement.addEventListener('pointermove', (event) => {
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => {
      const dockBounds = dockElement.getBoundingClientRect();
      const pointerPosition = dockElement.classList.contains('is-vertical')
        ? event.clientY - dockBounds.top
        : event.clientX - dockBounds.left;
      updateDock(pointerPosition);
    });
  });

  dockElement.addEventListener('pointerleave', () => {
    cancelAnimationFrame(animationFrame);
    const apps = [...dockElement.querySelectorAll('.bottom-bar-apps .apps')];
    apps.forEach((app) => {
      app.style.setProperty('--dock-scale', '1');
      app.style.setProperty('--dock-shift-x', '0rem');
      app.style.setProperty('--dock-shift-y', '0rem');
    });
  });
}

async function fetchLocationData() {
  const response = await fetch('https://free.freeipapi.com/api/json/');
  if (!response.ok) throw new Error('Failed to fetch location');
  return await response.json();
}

// not using it
function fetchBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browser geolocation is unavailable'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve(`${coords.latitude},${coords.longitude}`),
      reject,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 }
    );
  });
}

async function fetchWeatherData(location) {
  const response = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
  if (!response.ok) throw new Error('Failed to fetch weather');
  return await response.json();
}

function getWeatherIconClass(conditionText, isDay) {
  const text = conditionText.toLowerCase();

  if (text.includes('thunder') || text.includes('lightning')) return 'bi-cloud-lightning-rain';
  if (text.includes('snow') || text.includes('sleet') || text.includes('ice')) return 'bi-cloud-snow';
  if (text.includes('rain') || text.includes('drizzle') || text.includes('shower')) return 'bi-cloud-rain';
  if (text.includes('fog') || text.includes('mist')) return 'bi-cloud-fog';
  if (text.includes('overcast') || text.includes('cloud')) {
    return isDay ? 'bi-cloud-sun' : 'bi-cloud-moon';
  }
  if (text.includes('clear') || text.includes('sunny')) {
    return isDay ? 'bi-sun' : 'bi-moon-stars';
  }

  return isDay ? 'bi-cloud-sun' : 'bi-cloud-moon';
}

function formatTemperature(value) {
  return `${value}\u00B0C`;
}

function formatForecastDate(dateText) {
  return new Date(`${dateText}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function updateForecastModal(weatherData, location, condition, temp, iconClass, isDay) {
  const current = weatherData.current_condition[0];
  const weatherDay = weatherData.weather?.[0];
  const astronomy = weatherDay?.astronomy?.[0];
  const modal = document.querySelector('.weather-modal');

  modal.querySelector('#weather-panel-title').textContent = location;
  modal.querySelector('.weather-panel-date').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });
  modal.querySelector('.weather-panel-icon').innerHTML = `<i class="bi ${iconClass}"></i>`;
  modal.querySelector('.weather-panel-temperature').textContent = formatTemperature(temp);
  modal.querySelector('.weather-panel-condition').textContent = condition;

  const metrics = {
    'feels-like': formatTemperature(current.FeelsLikeC),
    humidity: `${current.humidity}%`,
    wind: `${current.windspeedKmph} km/h`,
    visibility: `${current.visibility} km`,
    uv: current.uvIndex,
    rain: `${current.chanceofrain || weatherDay?.hourly?.[0]?.chanceofrain || 0}%`
  };
  Object.entries(metrics).forEach(([key, value]) => {
    modal.querySelector(`[data-weather="${key}"]`).textContent = value;
  });
  modal.querySelector('[data-weather="sunrise"]').textContent = astronomy?.sunrise || '--';
  modal.querySelector('[data-weather="sunset"]').textContent = astronomy?.sunset || '--';

  const forecastList = modal.querySelector('.forecast-list');
  forecastList.innerHTML = (weatherData.weather || []).slice(0, 3).map((day, index) => {
    const dayCondition = day.hourly?.[4]?.weatherDesc?.[0]?.value || condition;
    const dayIsDay = index === 0 ? isDay : true;
    const dayIcon = getWeatherIconClass(dayCondition, dayIsDay);
    return `<article class="forecast-day">
      <span class="forecast-day-name">${index === 0 ? 'Today' : formatForecastDate(day.date)}</span>
      <i class="bi ${dayIcon}"></i>
      <span class="forecast-day-condition">${dayCondition}</span>
      <span class="forecast-day-temp">${formatTemperature(day.maxtempC)} / ${formatTemperature(day.mintempC)}</span>
    </article>`;
  }).join('');
}

function setupWeatherModal(weatherData) {
  const weatherWidget = document.querySelector('.weather');
  const modal = document.querySelector('.weather-modal');
  const closeButton = modal.querySelector('.weather-close');
  const backdrop = modal.querySelector('.weather-modal-backdrop');
  const panel = modal.querySelector('.weather-panel');
  let closeTimer;

  function closeModal() {
    if (!modal.classList.contains('is-open')) return;
    clearTimeout(closeTimer);
    weatherWidget.classList.remove('is-morphing');
    weatherWidget.focus();
    modal.classList.remove('is-expanded');
    modal.setAttribute('aria-hidden', 'true');
    weatherWidget.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('weather-modal-active');
    closeTimer = setTimeout(() => {
      modal.classList.remove('is-open');
    }, 420);
  }

  function openModal() {
    clearTimeout(closeTimer);
    const widgetBounds = weatherWidget.getBoundingClientRect();
    modal.style.setProperty('--weather-origin-top', `${widgetBounds.top}px`);
    modal.style.setProperty('--weather-origin-left', `${widgetBounds.left}px`);
    modal.style.setProperty('--weather-origin-width', `${widgetBounds.width}px`);
    modal.style.setProperty('--weather-origin-height', `${widgetBounds.height}px`);
    weatherWidget.classList.add('is-morphing');
    document.body.classList.add('weather-modal-active');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    weatherWidget.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => modal.classList.add('is-expanded'));
    closeButton.focus();
  }

  weatherWidget.addEventListener('click', openModal);
  weatherWidget.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openModal();
    }
  });
  closeButton.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
}

function formatTimer(seconds) {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainingSeconds}`;
}

function renderCalendar(calendarDate) {
  const monthLabel = document.querySelector('.calendar-month');
  const weekdays = document.querySelector('.calendar-weekdays');
  const calendarGrid = document.querySelector('.calendar-grid');
  const today = new Date();
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPreviousMonth = new Date(year, month, 0).getDate();

  monthLabel.textContent = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  weekdays.innerHTML = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    .map((day) => `<span>${day}</span>`)
    .join('');

  const days = [];
  for (let index = firstDay - 1; index >= 0; index -= 1) {
    days.push(`<span class="calendar-day is-other-month">${daysInPreviousMonth - index}</span>`);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    days.push(`<span class="calendar-day${isToday ? ' is-today' : ''}">${day}</span>`);
  }
  let nextDay = 1;
  while (days.length < 42) {
    days.push(`<span class="calendar-day is-other-month">${nextDay}</span>`);
    nextDay += 1;
  }
  calendarGrid.innerHTML = days.join('');
}

function setupTimeModal(clockElement) {
  const modal = document.querySelector('.time-modal');
  const closeButton = modal.querySelector('.weather-close');
  const backdrop = modal.querySelector('.weather-modal-backdrop');
  const formatButtons = [...modal.querySelectorAll('.time-format-button')];
  const timerDisplay = modal.querySelector('.time-timer-display');
  const timerStart = modal.querySelector('.timer-start');
  const timerReset = modal.querySelector('.timer-reset');
  let closeTimer;
  let timerInterval;
  let elapsedSeconds = 0;
  let calendarDate = new Date();

  function closeModal() {
    if (!modal.classList.contains('is-open')) return;
    clearTimeout(closeTimer);
    clockElement.classList.remove('is-morphing');
    clockElement.focus();
    modal.classList.remove('is-expanded');
    modal.setAttribute('aria-hidden', 'true');
    clockElement.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('weather-modal-active');
    closeTimer = setTimeout(() => modal.classList.remove('is-open'), 420);
  }

  function openModal() {
    clearTimeout(closeTimer);
    const clockBounds = clockElement.getBoundingClientRect();
    modal.style.setProperty('--weather-origin-top', `${clockBounds.top}px`);
    modal.style.setProperty('--weather-origin-left', `${clockBounds.left}px`);
    modal.style.setProperty('--weather-origin-width', `${clockBounds.width}px`);
    modal.style.setProperty('--weather-origin-height', `${clockBounds.height}px`);
    clockElement.classList.add('is-morphing');
    document.body.classList.add('weather-modal-active');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    clockElement.setAttribute('aria-expanded', 'true');
    renderCalendar(calendarDate);
    requestAnimationFrame(() => modal.classList.add('is-expanded'));
    closeButton.focus();
  }

  function updateFormat(nextFormat) {
    is24HourFormat = nextFormat === '24';
    if (currentSettings) {
      currentSettings.clockFormat = nextFormat;
      saveSettings(currentSettings);
    }
    formatButtons.forEach((button) => {
      const selected = button.dataset.format === nextFormat;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    updateClock(clockElement, is24HourFormat);
  }

  updateFormat(currentSettings?.clockFormat === '12' ? '12' : '24');

  formatButtons.forEach((button) => {
    button.addEventListener('click', () => updateFormat(button.dataset.format));
  });

  timerStart.addEventListener('click', () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = undefined;
      timerStart.innerHTML = '<i class="bi bi-play-fill"></i> Start';
      return;
    }

    timerStart.innerHTML = '<i class="bi bi-pause-fill"></i> Pause';
    timerInterval = setInterval(() => {
      elapsedSeconds += 1;
      timerDisplay.textContent = formatTimer(elapsedSeconds);
    }, 1000);
  });

  timerReset.addEventListener('click', () => {
    clearInterval(timerInterval);
    timerInterval = undefined;
    elapsedSeconds = 0;
    timerDisplay.textContent = formatTimer(elapsedSeconds);
    timerStart.innerHTML = '<i class="bi bi-play-fill"></i> Start';
  });

  modal.querySelector('.calendar-previous').addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderCalendar(calendarDate);
  });
  modal.querySelector('.calendar-next').addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderCalendar(calendarDate);
  });

  clockElement.addEventListener('click', openModal);
  clockElement.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openModal();
    }
  });
  closeButton.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
}

const appCatalog = {
  youtube: {
    label: 'YouTube',
    url: 'https://www.youtube.com',
    icon: 'https://www.youtube.com/s/desktop/6f290082/img/favicon_144x144.png'
  },
  gmail: {
    label: 'Gmail',
    url: 'https://mail.google.com',
    icon: 'https://ssl.gstatic.com/ui/v1/icons/mail/images/favicon_gmail_2026_v2.ico'
  },
  meet: {
    label: 'Meet',
    url: 'https://meet.google.com',
    icon: 'https://gstatic.com/meet/icons/favicon-2026-v2-96dp.png'
  },
  drive: {
    label: 'Drive',
    url: 'https://drive.google.com',
    icon: 'https://ssl.gstatic.com/docs/doclist/images/drive_favicon_2026_32dp.png'
  },
  spotify: {
    label: 'Spotify',
    url: 'https://open.spotify.com',
    icon: 'https://www.google.com/s2/favicons?domain=spotify.com&sz=64'
  },
  maps: {
    label: 'Maps',
    url: 'https://maps.google.com',
    icon: 'https://maps.google.com/favicon.ico'
  },
  github: {
    label: 'GitHub',
    url: 'https://github.com',
    icon: 'https://github.githubassets.com/favicons/favicon.png'
  },
  chatgpt: {
    label: 'ChatGPT',
    url: 'https://chatgpt.com',
    icon: 'https://chatgpt.com/favicon.ico'
  }
};

const defaultAppMeta = Object.fromEntries(
  Object.entries(appCatalog).map(([id, app]) => [id, { label: app.label, url: app.url, icon: app.icon }])
);

const defaultSettings = {
  textColor: '#f0ffff',
  textMode: 'color',
  glassColor: '#ffffff',
  blur: 20,
  uiScale: 1,
  background: 'video.mp4',
  customBackgrounds: [],
  clockFormat: '24',
  appsBoxes: [{ id: 'box-1', apps: ['youtube', 'gmail', 'meet', 'drive'], position: 'top-left', visible: true }],
  bottomBarApps: ['youtube', 'gmail', 'meet', 'drive'],
  barOrientation: 'horizontal',
  barPosition: 'bottom',
  barPopDirection: 'auto',
  musicService: 'spotify',
  appMeta: defaultAppMeta,
  customApps: {},
  widgetPositions: {}
};

function getSavedSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem('web-ui-settings'));
    const saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const savedAppsBoxes = Array.isArray(saved.appsBoxes) ? saved.appsBoxes : [];
    const appsBoxes = savedAppsBoxes.length ? savedAppsBoxes
      .filter((box) => box && typeof box === 'object')
      .map((box, index) => ({
        id: typeof box.id === 'string' && box.id ? box.id : `box-${index + 1}`,
        apps: Array.isArray(box.apps) ? box.apps.filter((id) => typeof id === 'string') : [],
        position: ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(box.position) ? box.position : 'top-left',
        visible: box.visible !== false
      })) : [{
      id: 'box-1',
      apps: Array.isArray(saved.appsBoxApps) ? saved.appsBoxApps : defaultSettings.appsBoxes[0].apps,
      position: saved.appsBoxPosition || 'top-left',
      visible: saved.appsBoxVisible !== false
    }];
    return {
      ...defaultSettings,
      ...saved,
      appMeta: { ...defaultAppMeta, ...(saved.appMeta && typeof saved.appMeta === 'object' ? saved.appMeta : {}) },
      customApps: saved.customApps && typeof saved.customApps === 'object' ? saved.customApps : {},
      customBackgrounds: Array.isArray(saved.customBackgrounds) ? saved.customBackgrounds : [],
      appsBoxes: appsBoxes.length ? appsBoxes : defaultSettings.appsBoxes,
      bottomBarApps: Array.isArray(saved.bottomBarApps) ? saved.bottomBarApps.filter((id) => typeof id === 'string') : defaultSettings.bottomBarApps,
      widgetPositions: saved.widgetPositions && typeof saved.widgetPositions === 'object' ? saved.widgetPositions : {}
    };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  localStorage.setItem('web-ui-settings', JSON.stringify(settings));
}

function normalizeGlassColor(value) {
  const hexMatch = String(value).trim().match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) return `#${hexMatch[1].toLowerCase()}`;
  const match = String(value).match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (!match || match.slice(1).some((channel) => Number(channel) > 255)) return null;
  return `#${match.slice(1).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
}

function glassColorToRgb(hexColor) {
  const value = normalizeGlassColor(hexColor) || defaultSettings.glassColor;
  return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)).join(', ');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[character]));
}

function getAppDefinition(appId, settings) {
  return {
    ...appCatalog[appId],
    ...(settings?.customApps?.[appId] || {}),
    ...(settings?.appMeta?.[appId] || {})
  };
}

function getAvailableApps(settings) {
  return { ...appCatalog, ...(settings.customApps || {}) };
}

function createAppElement(appId, settings) {
  const app = getAppDefinition(appId, settings);
  if (!app) return '';
  return `<span class="apps" data-app-id="${escapeHtml(appId)}"><a href="${escapeHtml(app.url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(app.icon)}" alt="${escapeHtml(app.label)}" class="icon"><span class="app-name">${escapeHtml(app.label)}</span></a></span>`;
}

function renderConfiguredApps(settings) {
  const bottomBarApps = document.querySelector('#bottom-bar-apps');
  bottomBarApps.innerHTML = settings.bottomBarApps.map((appId) => createAppElement(appId, settings)).join('');
  const appsBoxes = document.querySelector('#apps-boxes');
  appsBoxes.innerHTML = settings.appsBoxes.map((box) => `
    <div class="widget apps-box three-d${box.visible ? '' : ' is-hidden'} position-${box.position}" id="apps-${box.id}" data-box-id="${box.id}">
      ${box.apps.map((appId) => createAppElement(appId, settings)).join('')}
    </div>
  `).join('');
  applyWidgetPositions(settings);
}

// FUCK FUCK FUCK
function renderAppPickers(settings) {
  const availableApps = getAvailableApps(settings);
  const renderSlots = (appIds, target, limit) => `${appIds.map((id) => {
    const app = getAppDefinition(id, settings);
    return `<div class="app-slot"><span><img src="${escapeHtml(app.icon)}" alt=""> ${escapeHtml(app.label)}</span><button type="button" class="remove-app-slot" data-remove-app="${escapeHtml(id)}" data-remove-target="${escapeHtml(target)}" aria-label="Remove ${escapeHtml(app.label)}"><i class="bi bi-x"></i></button></div>`;
  }).join('')}${appIds.length < limit ? `<button type="button" class="add-app-slot" data-add-target="${escapeHtml(target)}"><i class="bi bi-plus-lg"></i> Add app <span>(${appIds.length}/${limit})</span></button>` : `<small class="slot-limit">${limit}/${limit} slots used</small>`}`;
  const picker = document.querySelector('[data-picker="bottomBar"]');
  picker.innerHTML = `<div class="drop-zone" data-drop-target="bottomBar">${renderSlots(settings.bottomBarApps, 'bottomBar', 10)}</div>`;
  const metadata = document.querySelector('.app-metadata-list');
  metadata.innerHTML = Object.entries(availableApps).map(([id, app]) => {
    const definition = getAppDefinition(id, settings);
    const customControls = settings.customApps?.[id] ? `<button class="remove-custom-app" type="button" data-remove-custom-app="${id}"><i class="bi bi-trash3"></i> Remove</button>` : '';
    return `<div class="app-metadata" data-app-library-id="${escapeHtml(id)}" draggable="true">
      <div class="app-metadata-title"><img class="app-preview-icon" src="${escapeHtml(definition.icon)}" alt=""><strong>${escapeHtml(definition.label)}</strong></div>
      <label>Name <input type="text" data-app-meta="${id}:label" value="${escapeHtml(definition.label)}"></label>
      <label>Route URL <input type="url" data-app-meta="${id}:url" value="${escapeHtml(definition.url)}"></label>
      <label>Icon URL <input type="url" data-app-meta="${id}:icon" value="${escapeHtml(definition.icon)}"></label>
      ${customControls}
    </div>`;
  }).join('');
  const boxesList = document.querySelector('.apps-box-settings-list');
  boxesList.innerHTML = settings.appsBoxes.map((box, index) => `
    <div class="apps-box-setting" data-box-setting="${box.id}">
      <div class="apps-box-setting-heading"><strong>Apps box ${index + 1}</strong><button class="remove-apps-box" type="button" data-remove-box="${box.id}" ${settings.appsBoxes.length === 1 ? 'disabled' : ''}><i class="bi bi-trash3"></i></button></div>
      <div class="app-slots drop-zone" data-drop-target="box:${escapeHtml(box.id)}">${renderSlots(box.apps, `box:${box.id}`, 9)}</div>
    </div>
  `).join('');
}

function applyWidgetPositions(settings) {
  document.querySelectorAll('.widget[data-draggable-id]').forEach((widget) => widget.removeAttribute('data-draggable-id'));
  const movableWidgets = [document.querySelector('.clock'), document.querySelector('.weather'), ...document.querySelectorAll('.apps-box')];
  movableWidgets.forEach((widget) => {
    if (!widget) return;
    const id = widget.classList.contains('apps-box') ? `apps-${widget.dataset.boxId}` : widget.classList.contains('clock') ? 'clock' : 'weather';
    widget.dataset.draggableId = id;
    const position = settings.widgetPositions[id];
    if (position) {
      widget.style.left = `${position.left}px`;
      widget.style.top = `${position.top}px`;
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';
    }
  });
}

function applyDockLayout(settings) {
  const dock = document.querySelector('#bottom-bar');
  if (!dock) return;

  const orientations = ['horizontal', 'vertical'];
  const positions = ['top', 'bottom', 'left', 'right'];
  const directions = ['auto', 'up', 'down', 'left', 'right'];
  const automaticDirections = { top: 'down', bottom: 'up', left: 'right', right: 'left' };

  const orientation = orientations.includes(settings.barOrientation) ? settings.barOrientation : defaultSettings.barOrientation;
  const position = positions.includes(settings.barPosition) ? settings.barPosition : defaultSettings.barPosition;
  const requestedDirection = directions.includes(settings.barPopDirection) ? settings.barPopDirection : defaultSettings.barPopDirection;
  const popDirection = requestedDirection === 'auto' ? automaticDirections[position] : requestedDirection;

  settings.barOrientation = orientation;
  settings.barPosition = position;
  settings.barPopDirection = requestedDirection;
  dock.classList.remove('is-horizontal', 'is-vertical', 'position-top', 'position-bottom', 'position-left', 'position-right', 'pop-up', 'pop-down', 'pop-left', 'pop-right');
  dock.classList.add(`is-${orientation}`, `position-${position}`, `pop-${popDirection}`);
  dock.dataset.popDirection = popDirection;
  dock.querySelectorAll('.bottom-bar-apps .apps').forEach((app) => {
    app.style.setProperty('--dock-scale', '1');
    app.style.setProperty('--dock-shift-x', '0rem');
    app.style.setProperty('--dock-shift-y', '0rem');
  });
}

function applySettings(settings) {
  const differenceMode = settings.textMode === 'difference';
  document.documentElement.style.setProperty('--ui-text-color', settings.textColor);
  document.documentElement.style.setProperty('--ui-blend-mode', differenceMode ? 'difference' : 'normal');
  document.documentElement.classList.toggle('is-difference-mode', differenceMode);
  const normalizedGlassColor = normalizeGlassColor(settings.glassColor) || defaultSettings.glassColor;
  settings.glassColor = normalizedGlassColor;
  document.documentElement.style.setProperty('--glass-rgb', glassColorToRgb(normalizedGlassColor));
  document.documentElement.style.setProperty('--glass-alpha', '0.15');
  document.documentElement.style.setProperty('--glass-blur', `${settings.blur}px`);
  document.documentElement.style.setProperty('--ui-scale', settings.uiScale);
  applyDockLayout(settings);
  document.querySelector('[data-setting="textColor"]').value = settings.textColor;
  document.querySelector('[data-setting="textColor"]').disabled = settings.textMode === 'difference';
  document.querySelector('[data-setting="textMode"]').value = settings.textMode;
  const glassColorControl = document.querySelector('[data-setting="glassColor"]');
  if (glassColorControl) glassColorControl.value = normalizedGlassColor;
  document.querySelector('[data-setting="barOrientation"]').value = settings.barOrientation;
  document.querySelector('[data-setting="barPosition"]').value = settings.barPosition;
  document.querySelector('[data-setting="barPopDirection"]').value = settings.barPopDirection;
  document.querySelector('[data-setting="blur"]').value = settings.blur;
  document.querySelector('[data-setting="uiScale"]').value = settings.uiScale;
  document.querySelector('[data-setting="musicService"]').value = settings.musicService;
  document.querySelector('[data-output="blur"]').textContent = `${settings.blur}px`;
  document.querySelector('[data-output="uiScale"]').textContent = `${Math.round(settings.uiScale * 100)}%`;
  renderBackgroundLibrary(settings);
  applyBackground(settings.background, settings);
  renderConfiguredApps(settings);
  renderAppPickers(settings);
  updateMusicPlayer(settings);
  syncDifferenceOverlays();
}

function syncDifferenceOverlays() {
  document.querySelectorAll('.difference-overlay').forEach((overlay) => overlay.remove());
  if (!document.documentElement.classList.contains('is-difference-mode')) return;

  const clock = document.querySelector('.clock');
  const clockTime = clock?.querySelector('.clock-time');
  if (clockTime) {
    const bounds = clockTime.getBoundingClientRect();
    const styles = getComputedStyle(clockTime);
    const overlay = document.createElement('div');
    overlay.className = 'difference-overlay clock-difference-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.textContent = clockTime.textContent;
    Object.assign(overlay.style, {
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      fontFamily: styles.fontFamily,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      fontStyle: styles.fontStyle,
      lineHeight: styles.lineHeight,
      letterSpacing: styles.letterSpacing,
      textAlign: styles.textAlign
    });
    document.body.append(overlay);
  }

  const weather = document.querySelector('.weather');
  if (weather) {
    const bounds = weather.getBoundingClientRect();
    const overlay = weather.cloneNode(true);
    overlay.classList.remove('widget', 'three-d', 'is-morphing', 'is-dragging');
    overlay.classList.add('difference-overlay', 'weather-difference-overlay');
    overlay.removeAttribute('id');
    overlay.removeAttribute('tabindex');
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      right: 'auto',
      bottom: 'auto',
      width: `${bounds.width}px`,
      height: `${bounds.height}px`
    });
    document.body.append(overlay);
  }
}

function updateMusicPlayer(settings) {
  const icon = document.querySelector('.music-service-icon');
  const link = document.querySelector('.music-link');
  const isSpotify = settings.musicService === 'spotify';
  icon.className = `bi ${isSpotify ? 'bi-spotify' : 'bi-youtube'} music-service-icon`;
  icon.style.color = settings.musicService === 'spotify' ? '#8be28b' : '#ff7676';
  link.href = isSpotify ? 'https://open.spotify.com/' : 'https://www.youtube.com/';
  link.setAttribute('aria-label', `Open ${isSpotify ? 'Spotify' : 'YouTube'}`);
}

const backgroundCatalog = [
  { file: 'image.png', label: 'Image background', type: 'image' },
  { file: 'video.mp4', label: 'Video background', type: 'video' },
  { file: 'video2.mp4', label: 'Video background', type: 'video'},
  { file: 'image2.jpeg', label: 'Image background', type: 'image' },
  { file: 'video3.mp4', label: 'Video background', type: 'video' },
  { file: 'image3.jpeg', label: 'Image background', type: 'image' },
  { file: 'image4.jpeg', label: 'Image background', type: 'image' },
  { file: 'image5.jpeg', label: 'Image background', type: 'image' },
  { file: 'image6.jpeg', label: 'Image background', type: 'image' },
  { file: 'image7.jpeg', label: 'Image background', type: 'image' },
  { file: 'image8.jpeg', label: 'Image background', type: 'image' },
];

function getBackgroundCatalog(settings) {
  return [...backgroundCatalog, ...(settings.customBackgrounds || [])];
}

function applyBackground(backgroundFile, settings) {
  const background = getBackgroundCatalog(settings).find((item) => item.file === backgroundFile) || backgroundCatalog[0];
  const source = background.src || `bgs/${encodeURIComponent(background.file)}`;
  const video = document.querySelector('.bg-video');
  const image = document.querySelector('.bg-image');
  if (background.type === 'video') {
    video.style.display = 'block';
    image.style.display = 'none';
    video.querySelector('source').src = source;
    video.load();
    video.play().catch(() => {});
  } else {
    video.pause();
    video.style.display = 'none';
    image.src = source;
    image.style.display = 'block';
  }
}

function renderBackgroundLibrary(settings) {
  const library = document.querySelector('[data-background-library]');
  if (!library) return;
  library.innerHTML = getBackgroundCatalog(settings).map((background) => `
    <button type="button" class="background-option${settings.background === background.file ? ' is-selected' : ''}" data-background-file="${background.file}">
      <span class="background-preview">
        ${background.type === 'video' ? `<video muted loop autoplay src="${escapeHtml(background.src || `bgs/${encodeURIComponent(background.file)}`)}"></video>` : `<img src="${escapeHtml(background.src || `bgs/${encodeURIComponent(background.file)}`)}" alt="">`}
      </span>
      <span class="background-option-info"><strong>${background.label}</strong><small>${background.type}</small></span>
      <i class="bi bi-check2 background-check"></i>
    </button>
  `).join('');
}

function setupSettings() {
  const modal = document.querySelector('#settings-modal');
  const trigger = document.querySelector('.settings-trigger');
  const closeButton = modal.querySelector('.settings-close');
  const backdrop = modal.querySelector('.settings-backdrop');
  const settings = getSavedSettings();
  let pendingAssignment;
  let dragScrollFrame;
  let dragPointerY = 0;
  currentSettings = settings;

  function closeSettings() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    trigger.focus();
    document.body.classList.remove('weather-modal-active');
  }

  // oh god! 
  function openSettings() {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('weather-modal-active');
    closeButton.focus();
  }

  applySettings(settings);
  modal.querySelector('[data-background-upload]').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file || (!file.type.startsWith('image/') && !file.type.startsWith('video/'))) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const background = {
        file: `custom-background-${Date.now()}`,
        label: file.name,
        type: file.type.startsWith('video/') ? 'video' : 'image',
        src: reader.result
      };
      settings.customBackgrounds.push(background);
      settings.background = background.file;
      applySettings(settings);
      saveSettings(settings);
      event.target.value = '';
    });
    reader.readAsDataURL(file);
  });
  trigger.addEventListener('click', openSettings);
  closeButton.addEventListener('click', closeSettings);
  backdrop.addEventListener('click', closeSettings);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) closeSettings();
  });

  modal.addEventListener('input', (event) => {
    const control = event.target.closest('[data-setting]');
    const appMetaControl = event.target.closest('[data-app-meta]');
    if (appMetaControl) {
      const [appId, field] = appMetaControl.dataset.appMeta.split(':');
      settings.appMeta[appId] ||= {};
      settings.appMeta[appId][field] = appMetaControl.value;
      renderConfiguredApps(settings);
      const metadataRow = appMetaControl.closest('.app-metadata');
      if (metadataRow) {
        const definition = getAppDefinition(appId, settings);
        metadataRow.querySelector('strong').textContent = definition.label;
        metadataRow.querySelector('.app-preview-icon').src = definition.icon;
      }
      saveSettings(settings);
      return;
    }
    if (!control) return;
    settings[control.dataset.setting] = control.type === 'range' ? Number(control.value) : control.value;
    if (control.dataset.setting === 'blur') document.querySelector('[data-output="blur"]').textContent = `${settings.blur}px`;
    if (control.dataset.setting === 'uiScale') document.querySelector('[data-output="uiScale"]').textContent = `${Math.round(settings.uiScale * 100)}%`;
    applySettings(settings);
    saveSettings(settings);
  });

  modal.addEventListener('change', (event) => {
    const control = event.target.closest('[data-setting]');
    if (!control) return;
    settings[control.dataset.setting] = control.value;
    applySettings(settings);
    saveSettings(settings);
  });

  modal.addEventListener('click', (event) => {
    const addButton = event.target.closest('[data-add-target]');
    if (addButton) {
      pendingAssignment = addButton.dataset.addTarget;
      const form = modal.querySelector('.custom-app-form');
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.querySelector('[name="name"]').focus();
      return;
    }
    const removeAppButton = event.target.closest('[data-remove-app]');
    if (removeAppButton) {
      const target = removeAppButton.dataset.removeTarget;
      if (target === 'bottomBar') {
        settings.bottomBarApps = settings.bottomBarApps.filter((id) => id !== removeAppButton.dataset.removeApp);
      } else if (target.startsWith('box:')) {
        const box = settings.appsBoxes.find((item) => item.id === target.slice(4));
        if (box) box.apps = box.apps.filter((id) => id !== removeAppButton.dataset.removeApp);
      }
      applySettings(settings);
      saveSettings(settings);
      return;
    }
    const removeCustomButton = event.target.closest('[data-remove-custom-app]');
    if (removeCustomButton) {
      const appId = removeCustomButton.dataset.removeCustomApp;
      delete settings.customApps[appId];
      delete settings.appMeta[appId];
      settings.bottomBarApps = settings.bottomBarApps.filter((id) => id !== appId);
      settings.appsBoxes.forEach((box) => {
        box.apps = box.apps.filter((id) => id !== appId);
      });
      applySettings(settings);
      saveSettings(settings);
      return;
    }
    const removeButton = event.target.closest('[data-remove-box]');
    if (!removeButton || settings.appsBoxes.length === 1) return;
    settings.appsBoxes = settings.appsBoxes.filter((box) => box.id !== removeButton.dataset.removeBox);
    applySettings(settings);
    saveSettings(settings);
  });

  modal.addEventListener('dragstart', (event) => {
    const libraryApp = event.target.closest('[data-app-library-id]');
    if (!libraryApp) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/app-id', libraryApp.dataset.appLibraryId);
    event.dataTransfer.setData('text/plain', libraryApp.dataset.appLibraryId);
    libraryApp.classList.add('is-dragging');
    modal.classList.add('is-dragging-app');
  });

  modal.addEventListener('dragend', (event) => {
    event.target.closest('[data-app-library-id]')?.classList.remove('is-dragging');
    modal.classList.remove('is-dragging-app');
    cancelAnimationFrame(dragScrollFrame);
    dragScrollFrame = undefined;
  });

  modal.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dragPointerY = event.clientY;
    const dropZone = event.target.closest('[data-drop-target]');
    document.querySelectorAll('.is-drop-target').forEach((zone) => zone.classList.remove('is-drop-target'));
    dropZone?.classList.add('is-drop-target');
    if (!dragScrollFrame) autoScrollSettingsPanel();
  });

  modal.addEventListener('dragleave', (event) => {
    event.target.closest('[data-drop-target]')?.classList.remove('is-drop-target');
  });

  modal.addEventListener('drop', (event) => {
    const dropZone = event.target.closest('[data-drop-target]');
    if (!dropZone) return;
    event.preventDefault();
    dropZone.classList.remove('is-drop-target');
    const appId = event.dataTransfer.getData('text/app-id') || event.dataTransfer.getData('text/plain');
    const target = dropZone.dataset.dropTarget;
    const targetApps = target === 'bottomBar'
      ? settings.bottomBarApps
      : settings.appsBoxes.find((box) => box.id === target.slice(4))?.apps;
    const limit = target === 'bottomBar' ? 10 : 9;
    if (!appId || !targetApps || targetApps.includes(appId) || targetApps.length >= limit) return;
    targetApps.push(appId);
    applySettings(settings);
    saveSettings(settings);
    cancelAnimationFrame(dragScrollFrame);
    dragScrollFrame = undefined;
  });

  function autoScrollSettingsPanel() {
    const panel = modal.querySelector('.settings-panel');
    const bounds = panel.getBoundingClientRect();
    const edgeSize = 72;
    let scrollDelta = 0;
    if (dragPointerY < bounds.top + edgeSize) {
      scrollDelta = -Math.ceil((bounds.top + edgeSize - dragPointerY) / 5);
    } else if (dragPointerY > bounds.bottom - edgeSize) {
      scrollDelta = Math.ceil((dragPointerY - (bounds.bottom - edgeSize)) / 5);
    }
    if (scrollDelta !== 0) panel.scrollTop += scrollDelta;
    dragScrollFrame = requestAnimationFrame(autoScrollSettingsPanel);
  }

  modal.querySelector('.add-apps-box').addEventListener('click', () => {
    if (settings.appsBoxes.length >= 9) return;
    settings.appsBoxes.push({
      id: `box-${Date.now()}`,
      apps: [],
      position: 'top-left',
      visible: true
    });
    applySettings(settings);
    saveSettings(settings);
  });

  modal.querySelector('.custom-app-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const appId = `custom-${Date.now()}`;
    settings.customApps[appId] = {
      label: String(formData.get('name')).trim(),
      url: String(formData.get('url')).trim(),
      icon: String(formData.get('icon')).trim()
    };
    if (pendingAssignment === 'bottomBar' && settings.bottomBarApps.length < 10) {
      settings.bottomBarApps.push(appId);
    } else if (pendingAssignment?.startsWith('box:')) {
      const box = settings.appsBoxes.find((item) => item.id === pendingAssignment.slice(4));
      if (box && box.apps.length < 9) box.apps.push(appId);
    }
    pendingAssignment = undefined;
    applySettings(settings);
    saveSettings(settings);
    event.currentTarget.reset();
  });

  modal.querySelector('.settings-reset').addEventListener('click', () => {
    Object.assign(settings, defaultSettings);
    is24HourFormat = settings.clockFormat === '24';
    updateClock(document.querySelector('.clock'), is24HourFormat);
    applySettings(settings);
    saveSettings(settings);
  });

  modal.addEventListener('click', (event) => {
    const backgroundOption = event.target.closest('[data-background-file]');
    if (!backgroundOption) return;
    settings.background = backgroundOption.dataset.backgroundFile;
    applySettings(settings);
    saveSettings(settings);
  });
}

function setupMovableWidgets() {
  const settings = currentSettings || getSavedSettings();
  let dragState = null;

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const widget = event.target.closest('.clock, .weather, .apps-box');
    if (!widget || widget.classList.contains('is-hidden') || widget.closest('.weather-modal, .settings-modal')) return;
    const bounds = widget.getBoundingClientRect();
    dragState = {
      widget,
      id: widget.dataset.draggableId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: bounds.left,
      originTop: bounds.top,
      moved: false
    };
  });

  document.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(deltaX, deltaY) < 6) return;
    dragState.moved = true;
    const widget = dragState.widget;
    widget.classList.add('is-dragging');
    widget.style.left = `${Math.max(0, dragState.originLeft + deltaX)}px`;
    widget.style.top = `${Math.max(0, dragState.originTop + deltaY)}px`;
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
    syncDifferenceOverlays();
  });

  document.addEventListener('pointerup', () => {
    if (!dragState) return;
    const completedDrag = dragState;
    if (completedDrag.moved) {
      const bounds = completedDrag.widget.getBoundingClientRect();
      settings.widgetPositions[completedDrag.id] = { left: Math.round(bounds.left), top: Math.round(bounds.top) };
      saveSettings(settings);
      completedDrag.widget.dataset.dragged = 'true';
      setTimeout(() => completedDrag.widget.removeAttribute('data-dragged'), 0);
    }
    completedDrag.widget.classList.remove('is-dragging');
    dragState = null;
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const widget = event.target.closest('.clock, .weather, .apps-box');
    if (!widget?.dataset.dragged) return;
    event.preventDefault();
    event.stopPropagation();
    widget.removeAttribute('data-dragged');
  }, true);
}

// i dont know how it is done. 
function getMinutesFromTime(timeText) {
  const match = timeText.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hours += 12;
  return hours * 60 + Number(match[2]);
}

function isDaylight(weatherData, fallback) {
  const astronomy = weatherData.weather?.[0]?.astronomy?.[0];
  const sunrise = astronomy && getMinutesFromTime(astronomy.sunrise);
  const sunset = astronomy && getMinutesFromTime(astronomy.sunset);

  if (sunrise === null || sunset === null || sunrise === undefined || sunset === undefined) {
    return fallback;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= sunrise && currentMinutes < sunset;
}

function updateWeatherWidget(weatherData) {
  const current = weatherData.current_condition[0];
  const location = weatherData.nearest_area[0].areaName[0].value;
  const condition = current.weatherDesc[0].value;
  const temp = current.temp_C;
  const isDay = isDaylight(weatherData, current.is_day !== 'no');

  const iconClass = getWeatherIconClass(condition, isDay);

  const widget = document.querySelector('.widget.weather');
  if (!widget) return;

  widget.querySelector('.weather-location').textContent = location;
  widget.querySelector('.weather-condition-name').textContent = condition;
  widget.querySelector('.temperature').textContent = `${temp}\u00B0C`;

  const logoSpan = widget.querySelector('.weather-condition-logo');
  logoSpan.innerHTML = `<i class="bi ${iconClass}"></i>`;
  updateForecastModal(weatherData, location, condition, temp, iconClass, isDay);
  syncDifferenceOverlays();
}

async function initWeather() {
  try {
    let location = 'auto';

    try {
      const locationData = await fetchLocationData();  // using fetchLocationData instead of fetchBrowserLocation because i think it s more reliable in cross device
      location = locationData.cityName || locationData.regionName;
    } catch (ipLocationError) {
      try {
        location = await fetchBrowserLocation();
      } catch (browserLocationError) {
        console.warn('Browser location unavailable, using IP location:', browserLocationError);
        console.warn('IP location unavailable, using weather API autodetection:', ipLocationError);
      }
    }

    const data = await fetchWeatherData(location);
    updateWeatherWidget(data);
    setupWeatherModal(data);
  } catch (err) {
    console.error('Weather widget error:', err);
  }
}


function openSearch() {
  const searchWidget = document.getElementById("search-modal");
  const searchBackdrop = document.getElementById("search-backdrop");
  const searchInput = document.getElementById("google-search-input");

  searchBackdrop.classList.add("is-open");
  searchBackdrop.setAttribute("aria-hidden", "false");

  searchWidget.classList.add("is-open");
  searchWidget.setAttribute("aria-hidden", "false");

  requestAnimationFrame(() => {
    searchInput.focus();
    searchInput.select();
  });
}

function closeSearch() {
  const searchWidget = document.getElementById("search-modal");
  const searchBackdrop = document.getElementById("search-backdrop");
  const searchInput = document.getElementById("google-search-input");
  const suggestionsBox = document.getElementById("google-suggestions");
  const searchClose = document.getElementById("search-close");

  searchWidget.classList.remove("is-open");
  searchWidget.setAttribute("aria-hidden", "true");

  searchBackdrop.classList.remove("is-open");
  searchBackdrop.setAttribute("aria-hidden", "true");

  searchClose.style.display = "none";

  suggestionsBox.classList.remove("has-results");
  suggestionsBox.innerHTML = "Type to search the web";

  activeSuggestions = [];
  selectedIndex = -1;
  searchInput.value = "";
}


function renderSuggestions(suggestions) {
  const searchInput = document.getElementById("google-search-input");
  const suggestionsBox = document.getElementById("google-suggestions");

  activeSuggestions = suggestions;
  selectedIndex = -1;
  suggestionsBox.innerHTML = "";

  if (!suggestions.length) {
    suggestionsBox.classList.remove("has-results");
    return;
  }

  suggestionsBox.classList.add("has-results");

  suggestions.forEach((suggestion, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "search-suggestion widget three-d";
    item.setAttribute("role", "option");
    item.dataset.index = String(index);
    item.innerHTML = `<i class="bi bi-search" aria-hidden="true"></i><span></span>`;
    item.querySelector("span").textContent = suggestion;

    item.addEventListener("mouseenter", () => setSelected(index));
    item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        searchInput.value = suggestion;
        submitSearch();
    });

    suggestionsBox.appendChild(item);
  });
}

function setSelected(index) {
  const searchInput = document.getElementById("google-search-input");
  const suggestionsBox = document.getElementById("google-suggestions");
  const items = suggestionsBox.querySelectorAll(".search-suggestion");

  items.forEach(item => item.classList.remove("is-selected"));

  selectedIndex = index;
  if (selectedIndex >= 0 && selectedIndex < items.length) {
    const item = items[selectedIndex];
    item.classList.add("is-selected");
    item.scrollIntoView({ block: "nearest" });
    searchInput.setAttribute("aria-activedescendant", `google-suggestion-${selectedIndex}`);
    item.id = `google-suggestion-${selectedIndex}`;
  } else {
    searchInput.removeAttribute("aria-activedescendant");
  }
}

function submitSearch() {
  const searchInput = document.getElementById("google-search-input");
  const searchForm = document.getElementById("google-search-form");
  const query = searchInput.value.trim();
  if (!query) return;
  searchForm.submit();
}

function fetchGoogleSuggestions(query) {
  return new Promise((resolve, reject) => {
    const callbackName = `__googleSuggest_${Date.now()}_${jsonpId++}`;
    const script = document.createElement("script");
    let finished = false;

    const cleanup = () => {
      if (finished) return;
        finished = true;
        clearTimeout(timeout);
        delete window[callbackName];
        script.remove();
    };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Google suggestions timed out"));
    }, 5000);

    window[callbackName] = (data) => {
        cleanup();
        const suggestions = Array.isArray(data) && Array.isArray(data[1])
          ? data[1].filter(value => typeof value === "string")
          : [];
        resolve(suggestions);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Could not load Google suggestions"));
    };

    const params = new URLSearchParams({
        client: "chrome",
        hl: "en",
        gl: "in",
        q: query,
        callback: callbackName
    });

    script.src = `https://suggestqueries.google.com/complete/search?${params.toString()}`;
    document.head.appendChild(script);
  });
}

async function updateSuggestions() {
  const searchInput = document.getElementById("google-search-input");
  const query = searchInput.value.trim();
  const currentRequest = ++requestId;

  if (!query) {
    renderSuggestions([]);
    return;
  }

  try {
    const suggestions = await fetchGoogleSuggestions(query);
    if (currentRequest !== requestId) return;

    renderSuggestions(
      [...new Set(suggestions)]
        .filter(suggestion => suggestion.toLowerCase() !== query.toLowerCase())
        .slice(0, 10)
    );
  } catch (error) {
    if (currentRequest === requestId) {
      console.warn("Google autocomplete unavailable:", error);
      renderSuggestions([]);
    }
  }
}


window.onload = () => {
  const clockElement = document.querySelector('.widget.clock');
  const searchInput = document.getElementById("google-search-input");
  const searchForm = document.getElementById("google-search-form");
  const suggestionsBox = document.getElementById("google-suggestions");
  const searchClose = document.querySelector(".search-close");
  const searchTrigger = document.querySelector(".bar-left");
  const searchBottomBar = document.querySelector(".google-search");
  const searchBackdrop = document.getElementById("search-backdrop");

  searchTrigger?.addEventListener("click", openSearch);
  searchClose?.addEventListener("click", closeSearch);

  searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateSuggestions, 180);

      if (searchInput.value === "") {
          document.getElementById("search-close").style.display = "none";
          document.getElementById("google-search-input").classList.remove("has-value");
      } else {
        document.getElementById("search-close").style.display = "inline";
        document.getElementById("google-search-input").classList.add("has-value");
      }
  });

  searchInput.addEventListener("keydown", (event) => {
      const count = activeSuggestions.length;

      if (event.key === "ArrowDown" && count) {
          event.preventDefault();
          setSelected((selectedIndex + 1) % count);
          return;
      }

      if (event.key === "ArrowUp" && count) {
          event.preventDefault();
          setSelected((selectedIndex - 1 + count) % count);
          return;
      }

      if (event.key === "Escape") {
          event.preventDefault();
          closeSearch();
          return;
      }

      if (event.key === "Enter" && selectedIndex >= 0 && activeSuggestions[selectedIndex]) {
          event.preventDefault();
          searchInput.value = activeSuggestions[selectedIndex];
          submitSearch();
      }
  });

  searchForm.addEventListener("submit", (event) => {
      const query = searchInput.value.trim();
      if (!query) event.preventDefault();
  });

  document.addEventListener("keydown", (event) => {
      if (event.key === "/" && document.activeElement !== searchInput && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const tag = document.activeElement?.tagName;
          if (!["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
              event.preventDefault();
              openSearch();
          }
      }
  });

  searchBottomBar.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSearch();
  });

  searchBackdrop?.addEventListener("click", closeSearch);

  updateClock(clockElement, is24HourFormat);
  switchToImageIfVideoUnsupported();
  setupSettings();
  setupDock(document.querySelector('.bottom-bar'));
  setupMovableWidgets();
  setupTimeModal(clockElement);
  setInterval(() => updateClock(clockElement, is24HourFormat), 1000);
  initWeather();
};

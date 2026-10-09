/* ═══════════════════════════════════════════════════════
   WATTSONS v2 — script.js
   Smart Energy Dashboard — Full Logic
   ══════════════════════════════════════════════════════ */
'use strict';

/* ════════════════════════════════════════════════════════
   1. AUTH GUARD — Check login before loading dashboard
════════════════════════════════════════════════════════ */
requireAuth(user => {
  // User is authenticated — init the dashboard
  initDashboard(user);
});

/* ════════════════════════════════════════════════════════
   2. GLOBAL STATE
════════════════════════════════════════════════════════ */
const state = {
  voltage:     0.0,
  current:     0.0,
  power:       0.0,
  energy:      0.0,
  powerFactor: 0.95,
  lastUpdate:  Date.now(),
  startTime:   Date.now(),
  alertActive: false,
  alertLog:    [],
  alertFilter: 'all',
  realtimeBuffer: [],
  hourlyData:  [],
  dailyData:   [],
  weeklyData:  [],
  peakHour:    null,
  peakValue:   0,
  updateCount: 0,
  rssi:        -65,
  latency:     12,
  lastReadingTime: null,
  lastReadingReceivedAt: null,
  sensorConnected: false,
  liveData:    false,
  predictedDevice: null,
  predictionConfidence: 0,
};

/* ════════════════════════════════════════════════════════
   3. DEVICE CATALOGUE
   All simulated devices with power signatures
════════════════════════════════════════════════════════ */
const DEVICE_CATALOGUE = [
  { id:'fan',      name:'Ceiling Fan',     icon:'🌀', type:'Ventilation',   basePower: 75,   range:[40,90],   alwaysOn: false },
  { id:'lights',   name:'LED Lights',      icon:'💡', type:'Lighting',      basePower: 45,   range:[20,60],   alwaysOn: false },
  { id:'tv',       name:'Smart TV',        icon:'�', type:'Entertainment', basePower: 120,  range:[80,150],  alwaysOn: false },
  { id:'router',   name:'WiFi Router',     icon:'📡', type:'Network',       basePower: 18,   range:[12,22],   alwaysOn: true  },
  { id:'fridge',   name:'Refrigerator',    icon:'❄️', type:'Appliance',     basePower: 150,  range:[80,200],  alwaysOn: true  },
  { id:'iron',     name:'Clothes Iron',    icon:'♨️', type:'Heating',       basePower: 1200, range:[900,1400],alwaysOn: false },
  { id:'kettle',   name:'Electric Kettle', icon:'☕', type:'Heating',       basePower: 1500, range:[1200,1800],alwaysOn: false},
  { id:'charger',  name:'Phone Charger',   icon:'🔌', type:'Charging',      basePower: 20,   range:[10,25],   alwaysOn: false },
  { id:'ac',       name:'Air Conditioner', icon:'🌡️', type:'HVAC',          basePower: 1800, range:[1200,2400],alwaysOn: false},
  { id:'washer',   name:'Laptop Charger',  icon:'🔌', type:'Charging',      basePower: 500,  range:[300,700], alwaysOn: false },
];

// Device runtime state
const deviceStates = {};
DEVICE_CATALOGUE.forEach(d => {
  deviceStates[d.id] = {
    ...d,
    on:          d.alwaysOn,
    currentPower: d.alwaysOn ? d.basePower : 0,
    confidence:  0,
    uptime:      d.alwaysOn ? Math.floor(Math.random() * 3600) : 0,
  };
});

/* ════════════════════════════════════════════════════════
   4. SIMULATION ENGINE
════════════════════════════════════════════════════════ */
const SIM = {
  baseLoad:       350,
  noiseAmplitude: 80,
  spikeChance:    0.04,
  spikeMax:       2800,
  voltageBase:    230,
  voltageNoise:   5,
};

function fluctuateHighVoltage(voltage) {
  if (voltage <= 230) return voltage;
  return 225.08 + Math.random() * (235.14 - 225.08);
}

let targetPower = SIM.baseLoad;

function smoothTo(cur, tgt, alpha = 0.15) {
  return cur + (tgt - cur) * alpha;
}

function generateReading() {
  const now = Date.now();
  const dt  = (now - state.lastUpdate) / 1000;
  state.lastUpdate = now;
  state.updateCount++;

  const t    = now / 1000;
  const wave = Math.sin(t * 0.03)*200 + Math.sin(t * 0.11)*80 + Math.sin(t * 0.37)*30;
  targetPower = SIM.baseLoad + wave;
  if (Math.random() < SIM.spikeChance) targetPower += Math.random() * SIM.spikeMax * 0.5;
  targetPower = Math.max(0, Math.min(SIM.spikeMax, targetPower));

  state.power       = smoothTo(state.power, targetPower, 0.18);
  state.power       = Math.max(0, state.power);
  state.voltage     = fluctuateHighVoltage(
    smoothTo(state.voltage, SIM.voltageBase + (Math.random()-0.5)*SIM.voltageNoise, 0.1));
  state.powerFactor = 0.90 + Math.random() * 0.08;
  state.current     = state.voltage > 0 ? state.power / (state.voltage * state.powerFactor) : 0;
  state.energy     += (state.power / 1000) * (dt / 3600);

  // RSSI simulation
  state.rssi    = -60 - Math.floor(Math.random() * 20);
  state.latency = 8 + Math.floor(Math.random() * 20);
  state.lastReadingTime = new Date();
}

/** Detect which devices are active based on power level */
function detectDevices(power) {
  const detected = [];

  // Always-on base devices
  deviceStates.router.on = true;
  deviceStates.router.currentPower = deviceStates.router.basePower + Math.random() * 3;
  deviceStates.router.confidence   = 95;
  detected.push('router');

  deviceStates.fridge.on = true;
  deviceStates.fridge.currentPower = deviceStates.fridge.basePower * (0.4 + Math.random() * 0.6);
  deviceStates.fridge.confidence   = 90;
  detected.push('fridge');

  // Power-range based detection
  if (power > 30)   { deviceStates.charger.on = true;  deviceStates.charger.currentPower = 18 + Math.random()*5; deviceStates.charger.confidence = 70; detected.push('charger'); }
  else              { deviceStates.charger.on = false; deviceStates.charger.currentPower = 0; }

  if (power > 60)   { deviceStates.lights.on = true;   deviceStates.lights.currentPower  = 40 + Math.random()*20; deviceStates.lights.confidence  = 85; detected.push('lights'); }
  else              { deviceStates.lights.on = false;  deviceStates.lights.currentPower  = 0; }

  if (power > 100)  { deviceStates.fan.on = true;     deviceStates.fan.currentPower     = 65 + Math.random()*25; deviceStates.fan.confidence     = 80; detected.push('fan'); }
  else              { deviceStates.fan.on = false;    deviceStates.fan.currentPower     = 0; }

  if (power > 200)  { deviceStates.tv.on = true;      deviceStates.tv.currentPower      = 110 + Math.random()*40; deviceStates.tv.confidence      = 75; detected.push('tv'); }
  else              { deviceStates.tv.on = false;     deviceStates.tv.currentPower      = 0; }

  if (power > 450)  { deviceStates.washer.on = true;  deviceStates.washer.currentPower  = 450 + Math.random()*200; deviceStates.washer.confidence  = 65; detected.push('washer'); }
  else              { deviceStates.washer.on = false; deviceStates.washer.currentPower  = 0; }

  if (power > 900)  { deviceStates.iron.on = true;    deviceStates.iron.currentPower    = 1000 + Math.random()*300; deviceStates.iron.confidence    = 82; detected.push('iron'); }
  else              { deviceStates.iron.on = false;   deviceStates.iron.currentPower    = 0; }

  if (power > 1200) { deviceStates.kettle.on = true;  deviceStates.kettle.currentPower  = 1300 + Math.random()*300; deviceStates.kettle.confidence  = 78; detected.push('kettle'); }
  else              { deviceStates.kettle.on = false; deviceStates.kettle.currentPower  = 0; }

  if (power > 1600) { deviceStates.ac.on = true;      deviceStates.ac.currentPower      = 1600 + Math.random()*600; deviceStates.ac.confidence      = 70; detected.push('ac'); }
  else              { deviceStates.ac.on = false;     deviceStates.ac.currentPower      = 0; }

  return detected;
}

/* ════════════════════════════════════════════════════════
   5. HISTORICAL DATA GENERATION
════════════════════════════════════════════════════════ */
function generateHistoricalData() {
  const hour   = new Date().getHours();
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today  = new Date().getDay();

  state.hourlyData = Array.from({length:24}, (_, i) => {
    const h    = (hour - 23 + i + 24) % 24;
    const base = h >= 6 && h <= 22 ? 0.3 + Math.random()*0.8 : 0.05 + Math.random()*0.15;
    return { label: `${h}:00`, value: parseFloat(base.toFixed(3)) };
  });

  state.dailyData = Array.from({length:7}, (_, i) => {
    const d = (today - 6 + i + 7) % 7;
    return { label: days[d], value: parseFloat((2 + Math.random()*8).toFixed(2)) };
  });

  state.weeklyData = Array.from({length:8}, (_, i) => ({
    label: `W${i+1}`,
    value: parseFloat((20 + Math.random()*50).toFixed(1)),
  }));

  // Detect peak usage hour
  let maxVal = 0, maxIdx = 0;
  state.hourlyData.forEach((d, i) => { if (d.value > maxVal) { maxVal = d.value; maxIdx = i; } });
  state.peakHour  = state.hourlyData[maxIdx]?.label;
  state.peakValue = maxVal;
}

/* ════════════════════════════════════════════════════════
   6. DOM HELPERS
════════════════════════════════════════════════════════ */
function $(id) { return document.getElementById(id); }
function flash(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
function fmt(n, d=1) { return Number(n).toFixed(d); }

/* Read the latest ESP32 snapshot from Firebase Realtime Database. */
function startFirebaseReadings() {
  if (window.DEMO_MODE) return;

  const database = window.WattsonsAuth?.db?.();
  if (!database) {
    console.error('[Wattsons] Firebase database is not available');
    return;
  }

  database.ref('/readings/latest').on('value', snapshot => {
    const reading = snapshot.val();
    if (!reading || typeof reading !== 'object') return;

    const voltage = Number(reading.voltage);
    const current = Number(reading.current);
    const power = Number(reading.power);
    if (![voltage, current, power].every(Number.isFinite)) {
      console.warn('[Wattsons] Ignoring malformed Firebase reading:', reading);
      return;
    }

    const now = Date.now();
    state.lastReadingReceivedAt = now;
    if (voltage < 10 && current < 0.05) {
      state.voltage = 0;
      state.current = 0;
      state.power = 0;
      state.powerFactor = 0;
      state.sensorConnected = false;
      state.liveData = false;
      state.lastReadingTime = null;
      state.realtimeBuffer = [];
      Object.values(deviceStates).forEach(device => {
        device.on = false;
        device.currentPower = 0;
        device.confidence = 0;
      });
      return;
    }

    const elapsedHours = state.lastReadingTime
      ? Math.max(0, now - state.lastReadingTime) / 3600000
      : 0;

    if (!state.liveData) state.realtimeBuffer = [];

    state.voltage = fluctuateHighVoltage(voltage);
    state.current = current;
    state.power = Math.max(0, power);
    state.powerFactor = voltage > 0 && current > 0
      ? Math.min(1, Math.abs(power / (voltage * current)))
      : 0;
    state.energy += (state.power / 1000) * elapsedHours;
    state.lastReadingTime = now;
    state.lastUpdate = now;
    state.sensorConnected = true;
    state.liveData = true;
    state.updateCount++;
  }, error => {
    console.error('[Wattsons] Firebase readings listener failed:', error);
  });

  database.ref('/predictions/latest').on('value', snapshot => {
    const prediction = snapshot.val();
    if (!prediction || typeof prediction !== 'object') return;

    const label = String(prediction.label || '').trim().toUpperCase();
    const confidence = Number(prediction.confidence);
    if (!label || !Number.isFinite(confidence)) return;

    state.predictedDevice = label;
    state.predictionConfidence = confidence;
  }, error => {
    console.error('[Wattsons] Firebase prediction listener failed:', error);
  });
}

/* ════════════════════════════════════════════════════════
   7. UI UPDATE FUNCTIONS
════════════════════════════════════════════════════════ */

/** Metric cards */
function updateCards() {
  const settings   = UserSettings.load();
  const rate       = parseFloat($('rateInput')?.value || settings.ratePerKwh);
  const todayCost  = state.energy * rate;

  const hasSensorData = DEMO_MODE || (state.sensorConnected && state.liveData);
  const updates = [
    ['powerVal',   hasSensorData ? fmt(state.power,1) : '--',   'powerBar',   hasSensorData ? (state.power/SIM.spikeMax)*100 : 0],
    ['voltageVal', hasSensorData ? fmt(state.voltage,2) : '--', 'voltageBar', hasSensorData ? ((state.voltage-200)/60)*100 : 0],
    ['currentVal', hasSensorData ? fmt(state.current,2) : '--', 'currentBar', hasSensorData ? (state.current/15)*100 : 0],
    ['energyVal',  fmt(state.energy,3),       'energyBar',  (state.energy/settings.kwhLimit)*100],
    ['costVal',    fmt(todayCost,2),           'costBar',    (todayCost/500)*100],
    ['pfVal',      fmt(state.powerFactor,2),  'pfBar',      state.powerFactor*100],
  ];

  updates.forEach(([valId, valStr, barId, pct]) => {
    const el = $(valId);
    if (el) { el.textContent = valStr; flash(el); }
    const bar = $(barId);
    if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  });
}

/** Real-time chart */
function updateRealtimeChart() {
  const MAX = 30;
  state.realtimeBuffer.push(state.power);
  if (state.realtimeBuffer.length > MAX) state.realtimeBuffer.shift();
  const c = charts.realtime;
  if (!c) return;
  c.data.labels            = state.realtimeBuffer.map((_, i) => i);
  c.data.datasets[0].data  = [...state.realtimeBuffer];
  c.update('none');
}

/** Device gauge + smart detection list */
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 50;  // r=50

function updateLoadPanel() {
  if (!DEMO_MODE && (!state.sensorConnected || !state.liveData)) {
    const gf = $('gaugeFill');
    if (gf) {
      gf.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
      gf.style.stroke = '#6b7a99';
    }
    const gp = $('gaugePercent');
    if (gp) { gp.textContent = '--'; gp.style.color = '#6b7a99'; }
    const dl = $('deviceLabel');
    if (dl) dl.textContent = 'No sensor data';
    if ($('deviceCountBadge')) $('deviceCountBadge').textContent = '0';
    const sdList = $('smartDetectList');
    if (sdList) sdList.innerHTML = '<div style="font-size:12px;color:var(--text-dim);text-align:center;padding:8px">Connect sensors to detect devices</div>';
    return;
  }

  const pct = Math.min(100, (state.power / SIM.spikeMax) * 100);
  let color, label;
  if      (state.power < 50)   { color = '#6b7a99'; label = 'Idle — no load detected'; }
  else if (state.power < 200)  { color = '#00e5a0'; label = 'Light usage'; }
  else if (state.power < 700)  { color = '#00d4ff'; label = 'Normal household usage'; }
  else if (state.power < 1500) { color = '#ffcc00'; label = 'Heavy usage'; }
  else                         { color = '#ff4757'; label = '⚠ Peak load detected'; }

  // Gauge
  const gf = $('gaugeFill');
  if (gf) {
    gf.style.strokeDashoffset = GAUGE_CIRCUMFERENCE * (1 - pct/100);
    gf.style.stroke           = color;
  }
  const gp = $('gaugePercent');
  if (gp) { gp.textContent = Math.round(pct) + '%'; gp.style.color = color; }
  // Live readings use the measured voltage, current, and power signature.
  const detected = state.liveData
    ? applyLivePrediction()
    : detectDevices(state.power);
  const activeDetected = detected
    .map(id => deviceStates[id])
    .filter(d => d.on)
    .sort((a,b) => b.currentPower - a.currentPower)
    .slice(0, 4);
  const detectedLabel = activeDetected.map(device => device.name).join(' + ');
  const predictedLabel = state.liveData
    ? (detectedLabel ? `${detectedLabel} detected` : 'No matching device range')
    : label;
  const dl = $('deviceLabel'); if (dl) dl.textContent = predictedLabel;
  if ($('deviceCountBadge')) $('deviceCountBadge').textContent = detected.length;

  const sdList = $('smartDetectList'); if (!sdList) return;

  if (activeDetected.length === 0) {
    sdList.innerHTML = '<div style="font-size:12px;color:var(--text-dim);text-align:center;padding:8px">No active devices detected</div>';
    return;
  }

  sdList.innerHTML = activeDetected.map(d => `
    <div class="sd-item">
      <span class="sd-icon">${d.icon}</span>
      <span class="sd-name">${d.name}</span>
      <div class="sd-bar-wrap"><div class="sd-bar-fill" style="width:${d.confidence}%"></div></div>
      <span class="sd-conf">${d.confidence}%</span>
    </div>
  `).join('');
}

function applyLivePrediction() {
  Object.values(deviceStates).forEach(device => {
    device.on = false;
    device.currentPower = 0;
    device.confidence = 0;
  });

  const current = Number(state.current.toFixed(2));
  const scenarios = [
    { range: [4.63, 20.49], devices: ['fan'] },
    { range: [22.00, 23.50], devices: ['lights'] },
    { range: [35.68, 39.91], devices: ['charger'] },
    { range: [50.55, 55.04], devices: ['washer'] },
    { range: [27.09, 27.62], devices: ['fan', 'lights'] },
    { range: [39.66, 40.23], devices: ['fan', 'charger'] },
    { range: [45.77, 46.64], devices: ['fan', 'lights', 'charger'] },
  ];
  const match = scenarios.find(({ range: [min, max] }) => current >= min && current <= max);
  if (!match) return [];

  const powerPerDevice = state.power / match.devices.length;
  match.devices.forEach(id => {
    deviceStates[id].on = true;
    deviceStates[id].currentPower = powerPerDevice;
    deviceStates[id].confidence = 100;
  });
  return match.devices;
}

/** Device status bar */
function updateStatusBar() {
  if (!DEMO_MODE && (!state.sensorConnected || !state.liveData)) {
    if ($('dsbSignal')) $('dsbSignal').textContent = 'No sensor data';
    if ($('dsbLastUpdate')) $('dsbLastUpdate').textContent = '–';
    if ($('dsbLatency')) $('dsbLatency').textContent = '–';
    if ($('dsbConn')) {
      $('dsbConn').textContent = '✗ Disconnected';
      $('dsbConn').className = 'dsb-val conn-bad';
    }
    if ($('connDot')) $('connDot').className = 'conn-dot bad';
    if ($('connLabel')) $('connLabel').textContent = 'No sensor';
    if ($('signalBars')) $('signalBars').className = 'signal-bars poor';
    if ($('signalVal')) $('signalVal').textContent = 'No sensor data';
    if ($('latencyVal')) $('latencyVal').textContent = '–';
    return;
  }

  const rssi   = state.rssi;
  const latency = state.latency;
  const quality = rssi > -65 ? 'Good' : rssi > -75 ? 'Fair' : 'Weak';

  if ($('dsbSignal'))     $('dsbSignal').textContent  = `${rssi} dBm (${quality})`;
  if ($('dsbLastUpdate')) $('dsbLastUpdate').textContent = state.lastReadingTime
    ? state.lastReadingTime.toLocaleTimeString() : '–';
  if ($('dsbLatency'))    $('dsbLatency').textContent  = `${latency} ms`;

  // Uptime
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const h = Math.floor(elapsed/3600).toString().padStart(2,'0');
  const m = Math.floor((elapsed%3600)/60).toString().padStart(2,'0');
  const s = (elapsed%60).toString().padStart(2,'0');
  if ($('dsbUptime')) $('dsbUptime').textContent = `${h}:${m}:${s}`;

  // Connection label
  const conn = $('dsbConn');
  if (conn) {
    if      (rssi > -65) { conn.textContent = '● Stable';     conn.className = 'dsb-val conn-ok';   }
    else if (rssi > -75) { conn.textContent = '⚠ Weak Signal';conn.className = 'dsb-val conn-warn'; }
    else                 { conn.textContent = '✗ Unstable';   conn.className = 'dsb-val conn-bad';  }
  }

  // Topbar connection pill
  const connDot   = $('connDot');
  const connLabel = $('connLabel');
  if (connDot && connLabel) {
    connLabel.textContent = `${rssi} dBm`;
    if      (rssi > -65) { connDot.className = 'conn-dot'; }
    else if (rssi > -75) { connDot.className = 'conn-dot warn'; }
    else                 { connDot.className = 'conn-dot bad'; }
  }

  // Signal bars
  const bars = $('signalBars');
  if (bars) {
    bars.className = 'signal-bars ' + (rssi > -65 ? 'good' : rssi > -70 ? 'fair' : rssi > -75 ? 'weak' : 'poor');
  }

  // Settings page signal
  const sv = $('signalVal'); if (sv) sv.textContent = `${rssi} dBm (${quality})`;
  const lv = $('latencyVal'); if (lv) lv.textContent = `${latency} ms`;

  // Last updated badge
  const lub = $('lastUpdatedBadge');
  if (lub && state.lastReadingTime) lub.textContent = `Updated ${state.lastReadingTime.toLocaleTimeString()}`;
}

/* ════════════════════════════════════════════════════════
   8. LIVE DEVICES PAGE
════════════════════════════════════════════════════════ */
function renderDevicesPage() {
  const grid = $('devicesGrid'); if (!grid) return;

  const devices = Object.values(deviceStates);
  const onDevices  = devices.filter(d => d.on);
  const offDevices = devices.filter(d => !d.on);
  const totalPower = devices.reduce((s, d) => s + (d.currentPower || 0), 0);
  const activeCount = onDevices.length;

  if ($('dsTotal'))  $('dsTotal').textContent  = devices.length;
  if ($('dsOn'))     $('dsOn').textContent      = activeCount;
  if ($('dsOff'))    $('dsOff').textContent     = offDevices.length;
  if ($('dsPower'))  $('dsPower').textContent   = fmt(totalPower, 0) + ' W';
  if ($('deviceCountBadge')) $('deviceCountBadge').textContent = activeCount;

  // Render cards
  grid.innerHTML = [...onDevices, ...offDevices].map(d => {
    const pct = d.on ? Math.min(100, (d.currentPower / (d.basePower * 1.5)) * 100) : 0;
    const up  = d.on ? formatUptime(d.uptime + Math.floor((Date.now() - state.startTime)/1000)) : '–';
    return `
      <div class="device-card ${d.on ? 'on' : 'off'}">
        <div class="dc-top">
          <div class="dc-icon">${d.icon}</div>
          <div class="dc-info">
            <div class="dc-name">${d.name}</div>
            <div class="dc-type">${d.type}</div>
          </div>
          <div class="dc-status-dot"></div>
        </div>
        <div class="dc-power-row">
          <div>
            <span class="dc-power-val">${d.on ? fmt(d.currentPower, 0) : '0'}</span>
            <span class="dc-power-unit"> W</span>
          </div>
          <span class="dc-status-label">${d.on ? 'ON' : 'STANDBY'}</span>
        </div>
        <div class="dc-bar"><div class="dc-bar-fill" style="width:${pct}%"></div></div>
        <div class="dc-meta">
          <span>Confidence: ${d.on ? d.confidence + '%' : '–'}</span>
          <span>Uptime: ${up}</span>
        </div>
      </div>
    `;
  }).join('');
}

function formatUptime(secs) {
  if (secs <= 0) return '–';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ════════════════════════════════════════════════════════
   9. ALERT SYSTEM
════════════════════════════════════════════════════════ */
function checkAlerts() {
  if (!DEMO_MODE && !state.sensorConnected) {
    state.alertActive = false;
    return;
  }

  const settings  = UserSettings.load();
  const threshold = parseFloat($('thresholdInput')?.value || settings.threshold);
  const kwhLimit  = parseFloat($('kwhLimitInput')?.value  || settings.kwhLimit);
  const costLimit = parseFloat($('costAlertInput')?.value || 500);
  const rate      = parseFloat($('rateInput')?.value      || settings.ratePerKwh);
  const todayCost = state.energy * rate;
  const now       = new Date().toLocaleTimeString();

  // High power
  if (state.power > threshold && !state.alertActive) {
    state.alertActive = true;
    const msg = `High power usage: ${fmt(state.power,0)} W (limit: ${threshold} W)`;
    showAlertBanner(msg, 'danger');
    addAlert(msg, 'danger', now);
  } else if (state.power <= threshold * 0.9) {
    state.alertActive = false;
  }

  // kWh limit
  if (state.energy > kwhLimit * 0.9 && state.energy < kwhLimit) {
    addAlert(`Approaching daily energy limit: ${fmt(state.energy,2)} / ${kwhLimit} kWh`, 'warn', now);
  }

  // Cost alert
  if (todayCost > costLimit * 0.9 && todayCost < costLimit) {
    addAlert(`Daily cost nearing limit: LKR ${fmt(todayCost,2)} / ${costLimit}`, 'warn', now);
  }

  // Voltage out of range
  if (state.voltage < 210 || state.voltage > 250) {
    addAlert(`Voltage out of normal range: ${fmt(state.voltage,1)} V`, 'warn', now);
  }

  // Unusual spike detection
  if (state.updateCount > 5) {
    const recent = state.realtimeBuffer.slice(-5);
    const avg    = recent.reduce((s,v) => s+v, 0) / recent.length;
    if (state.power > avg * 1.8 && state.power > 200) {
      addAlert(`Unusual power spike: ${fmt(state.power,0)} W (avg ${fmt(avg,0)} W)`, 'spike', now);
    }
  }
}

function showAlertBanner(msg, type = 'danger') {
  const banner = $('alertBanner'); if (!banner) return;
  banner.style.display = 'flex';
  $('alertText').textContent = msg;
  if (type === 'warn') {
    banner.style.background  = 'rgba(255,204,0,0.1)';
    banner.style.borderColor = 'rgba(255,204,0,0.4)';
    banner.style.color       = 'var(--yellow)';
  } else {
    banner.style.background  = 'rgba(255,71,87,0.1)';
    banner.style.borderColor = 'rgba(255,71,87,0.4)';
    banner.style.color       = 'var(--red)';
  }
  setTimeout(() => { banner.style.display = 'none'; }, 6000);
}

let _lastAlertMsg = '', _lastAlertTs = 0;
function addAlert(msg, type, time) {
  if (msg === _lastAlertMsg && Date.now() - _lastAlertTs < 10000) return;
  _lastAlertMsg = msg; _lastAlertTs = Date.now();
  state.alertLog.unshift({ msg, type, time });
  if (state.alertLog.length > 30) state.alertLog.pop();
  renderAlertLog();
  updateAlertBadge();
}

function renderAlertLog() {
  const list = $('alertList'); if (!list) return;
  const filter = state.alertFilter;
  const items  = filter === 'all' ? state.alertLog : state.alertLog.filter(a => a.type === filter);

  if (items.length === 0) {
    list.innerHTML = `<div class="no-alerts">${state.alertLog.length === 0
      ? 'No alerts yet — all systems normal'
      : 'No alerts match the selected filter'}</div>`;
    return;
  }
  list.innerHTML = items.map(a => `
    <div class="alert-item ${a.type}">
      <span>${a.msg}</span>
      <span class="alert-time">${a.time}</span>
    </div>
  `).join('');
}

function updateAlertBadge() {
  const badge = $('alertCountBadge');
  if (badge) badge.textContent = state.alertLog.length;
}

/* ════════════════════════════════════════════════════════
   10. BILLING UPDATE
════════════════════════════════════════════════════════ */
function updateBilling() {
  const settings = UserSettings.load();
  const rate     = parseFloat($('rateInput')?.value || settings.ratePerKwh);
  const daily    = state.energy * rate;
  const weekly   = daily * 7;
  const monthly  = daily * 30;
  const annual   = daily * 365;

  if ($('dailyCost'))   $('dailyCost').textContent   = `LKR ${fmt(daily, 2)}`;
  if ($('weeklyCost'))  $('weeklyCost').textContent  = `LKR ${fmt(weekly, 2)}`;
  if ($('monthlyCost')) $('monthlyCost').textContent = `LKR ${fmt(monthly, 2)}`;
  if ($('annualCost'))  $('annualCost').textContent  = `LKR ${fmt(annual, 2)}`;
  if ($('costVal'))     $('costVal').textContent     = fmt(daily, 2);
}

/* ════════════════════════════════════════════════════════
   11. ANALYTICS — PEAK INSIGHT
════════════════════════════════════════════════════════ */
function updateInsightBanner() {
  const msg = $('insightMsg');
  if (!msg || !state.peakHour) return;

  const isCurrentlyPeak = state.power > 600;
  msg.textContent = isCurrentlyPeak
    ? `You are currently in peak usage. Try reducing high-power appliances.`
    : `Peak usage detected at ${state.peakHour} (${fmt(state.peakValue,2)} kWh). Try shifting heavy loads to off-peak hours.`;

  const badge = $('weeklyAvgBadge');
  if (badge && state.weeklyData.length) {
    const avg = state.weeklyData.reduce((s,d) => s+d.value, 0) / state.weeklyData.length;
    badge.textContent = `Avg: ${fmt(avg,1)} kWh/week`;
  }
}

/* ════════════════════════════════════════════════════════
   12. CHART INSTANCES
════════════════════════════════════════════════════════ */
const charts = {};

function getTheme() {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  return {
    grid:       dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    tick:       dark ? '#6b7a99' : '#8899aa',
    tooltipBg:  dark ? '#1a2235' : '#ffffff',
    tooltipTxt: dark ? '#e8edf5' : '#1a2235',
  };
}

function initRealtimeChart() {
  const ctx  = $('realtimeChart')?.getContext('2d'); if (!ctx) return;
  const grad = ctx.createLinearGradient(0, 0, 0, 180);
  grad.addColorStop(0, 'rgba(0,212,255,0.35)');
  grad.addColorStop(1, 'rgba(0,212,255,0.01)');
  const t = getTheme();

  charts.realtime = new Chart(ctx, {
    type: 'line',
    data: { labels:[], datasets:[{ data:[], borderColor:'#00d4ff', backgroundColor: grad,
      borderWidth:2, pointRadius:0, tension:0.4, fill:true }] },
    options: {
      responsive:true, maintainAspectRatio:false, animation:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{ display:false },
        tooltip:{ backgroundColor:t.tooltipBg, titleColor:t.tooltipTxt, bodyColor:'#00d4ff',
          borderColor:'#253045', borderWidth:1, callbacks:{ label: c => ` ${Number(c.raw).toFixed(1)} W` } } },
      scales:{
        x:{ display:false },
        y:{ min:0, grid:{ color:t.grid }, ticks:{ color:t.tick, font:{ family:'Space Mono', size:11 }, callback: v => v + ' W' } }
      }
    }
  });
}

function initAnalyticsCharts() {
  const t = getTheme();
  const makeGrad = (ctx, color, h=240) => {
    const g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0, color.replace(')', ',0.3)').replace('rgb', 'rgba'));
    g.addColorStop(1, color.replace(')', ',0.0)').replace('rgb', 'rgba'));
    return g;
  };

  // Usage line
  const ctxL = $('usageLineChart')?.getContext('2d'); if (!ctxL) return;
  charts.usageLine = new Chart(ctxL, {
    type:'line',
    data:{ labels: state.hourlyData.map(d=>d.label),
      datasets:[{ label:'kWh', data: state.hourlyData.map(d=>d.value),
        borderColor:'#00e5a0', backgroundColor:'rgba(0,229,160,0.12)',
        borderWidth:2.5, pointRadius:3, pointBackgroundColor:'#00e5a0', tension:0.4, fill:true }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ backgroundColor:t.tooltipBg, titleColor:t.tooltipTxt, bodyColor:'#00e5a0', borderColor:'#253045', borderWidth:1 } },
      scales:{
        x:{ ticks:{ color:t.tick, font:{size:11} }, grid:{ color:t.grid } },
        y:{ ticks:{ color:t.tick, font:{size:11}, callback: v=>v+' kWh' }, grid:{ color:t.grid } }
      }
    }
  });

  // Bar chart
  const ctxB = $('barChart')?.getContext('2d'); if (!ctxB) return;
  charts.bar = new Chart(ctxB, {
    type:'bar',
    data:{ labels: state.dailyData.map(d=>d.label),
      datasets:[{ label:'kWh', data: state.dailyData.map(d=>d.value),
        backgroundColor:'rgba(0,212,255,0.5)', borderColor:'#00d4ff',
        borderWidth:1, borderRadius:5 }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{ x:{ ticks:{ color:t.tick }, grid:{ color:t.grid } }, y:{ ticks:{ color:t.tick, callback: v=>v+' kWh' }, grid:{ color:t.grid } } }
    }
  });

  // Weekly trend
  const ctxW = $('weeklyTrendChart')?.getContext('2d'); if (!ctxW) return;
  charts.weeklyTrend = new Chart(ctxW, {
    type:'line',
    data:{ labels: state.weeklyData.map(d=>d.label),
      datasets:[{ label:'kWh', data: state.weeklyData.map(d=>d.value),
        borderColor:'#a78bfa', backgroundColor:'rgba(167,139,250,0.12)',
        borderWidth:2.5, pointRadius:4, pointBackgroundColor:'#a78bfa', tension:0.4, fill:true }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{ x:{ ticks:{ color:t.tick }, grid:{ color:t.grid } }, y:{ ticks:{ color:t.tick, callback: v=>v+' kWh' }, grid:{ color:t.grid } } }
    }
  });

  updateInsightBanner();
}

function initBillingCharts() {
  const t = getTheme();

  const ctxPie = $('billPieChart')?.getContext('2d'); if (!ctxPie) return;
  charts.pie = new Chart(ctxPie, {
    type:'doughnut',
    data:{ labels:['Lighting','Appliances','HVAC','Other'],
      datasets:[{ data:[15,40,35,10], backgroundColor:['#00d4ff','#00e5a0','#ffcc00','#a78bfa'],
        borderColor:'transparent', borderWidth:0, hoverOffset:8 }] },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'65%',
      plugins:{ legend:{ position:'bottom', labels:{ color:t.tick, padding:14, font:{size:12} } } }
    }
  });

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now    = new Date().getMonth();
  const actual = Array.from({length:now+1}, () => Math.round(1000+Math.random()*2000));
  const proj   = [...actual.slice(0,-1), null, ...Array.from({length:11-now}, () => Math.round(1200+Math.random()*1800))];

  const ctxProj = $('projectionChart')?.getContext('2d'); if (!ctxProj) return;
  charts.projection = new Chart(ctxProj, {
    type:'bar',
    data:{ labels:months,
      datasets:[
        { label:'Actual (LKR)',    data: actual.concat(new Array(12-actual.length).fill(null)),
          backgroundColor:'rgba(0,212,255,0.5)', borderColor:'#00d4ff', borderWidth:1, borderRadius:5 },
        { label:'Projected (LKR)', data: proj,
          backgroundColor:'rgba(167,139,250,0.35)', borderColor:'#a78bfa', borderWidth:1, borderRadius:5 },
      ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:t.tick, font:{size:12} } } },
      scales:{ x:{ ticks:{ color:t.tick }, grid:{ color:t.grid } }, y:{ ticks:{ color:t.tick, callback: v=>'Rs '+v }, grid:{ color:t.grid } } }
    }
  });
}

function refreshChartsTheme() {
  const t = getTheme();
  Object.values(charts).forEach(c => {
    if (!c) return;
    if (c.options.scales) {
      Object.values(c.options.scales).forEach(s => {
        if (s.ticks) s.ticks.color = t.tick;
        if (s.grid)  s.grid.color  = t.grid;
      });
    }
    if (c.options.plugins?.tooltip) {
      c.options.plugins.tooltip.backgroundColor = t.tooltipBg;
      c.options.plugins.tooltip.titleColor      = t.tooltipTxt;
    }
    if (c.options.plugins?.legend?.labels) c.options.plugins.legend.labels.color = t.tick;
    c.update();
  });
}

/* ════════════════════════════════════════════════════════
   13. CLOCK
════════════════════════════════════════════════════════ */
function updateClock() {
  const el = $('topbarTime');
  if (el) el.textContent = new Date().toLocaleString('en-GB',{
    weekday:'short', year:'numeric', month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
}

/* ════════════════════════════════════════════════════════
   14. THEME
════════════════════════════════════════════════════════ */
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const dt = $('darkModeToggle'); if (dt) dt.checked = dark;
  UserSettings.update('darkMode', dark);
  requestAnimationFrame(refreshChartsTheme);
}

/* ════════════════════════════════════════════════════════
   15. SECTION NAVIGATION
════════════════════════════════════════════════════════ */
function switchSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const target = $(`sec-${id}`);
  if (target) target.classList.add('active');
  document.querySelectorAll(`.nav-item[data-section="${id}"]`).forEach(n => n.classList.add('active'));

  const titles = { dashboard:'Live Dashboard', devices:'Live Devices', analytics:'Energy Analytics',
                   billing:'Bill Estimation', settings:'Settings' };
  const st = $('sectionTitle'); if (st) st.textContent = titles[id] || 'Dashboard';

  // Lazy-init charts
  if (id === 'analytics' && !charts.usageLine)   initAnalyticsCharts();
  if (id === 'billing'   && !charts.pie)          initBillingCharts();
  if (id === 'devices')                           renderDevicesPage();
}

/* ════════════════════════════════════════════════════════
   16. SETTINGS PERSISTENCE
════════════════════════════════════════════════════════ */
function loadSettingsIntoUI() {
  const s = UserSettings.load();
  if ($('rateInput'))       $('rateInput').value       = s.ratePerKwh;
  if ($('thresholdInput'))  $('thresholdInput').value   = s.threshold;
  if ($('kwhLimitInput'))   $('kwhLimitInput').value    = s.kwhLimit;
  if ($('darkModeToggle'))  $('darkModeToggle').checked = s.darkMode;
  if ($('alertSoundToggle'))$('alertSoundToggle').checked = s.alertSound;
  if ($('currencySelect'))  $('currencySelect').value   = s.currency;
  applyTheme(s.darkMode);
}

function saveSettings() {
  const s = {
    ratePerKwh: parseFloat($('rateInput')?.value || 45),
    threshold:  parseFloat($('thresholdInput')?.value || 1500),
    kwhLimit:   parseFloat($('kwhLimitInput')?.value || 10),
    darkMode:   $('darkModeToggle')?.checked ?? true,
    alertSound: $('alertSoundToggle')?.checked ?? true,
    currency:   $('currencySelect')?.value || 'LKR',
  };
  UserSettings.save(s);
  const btn = $('saveSettingsBtn');
  if (btn) {
    btn.textContent = '✓ Saved!';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.textContent = '💾 Save Settings'; btn.style.color = ''; }, 2000);
  }
}

/* ════════════════════════════════════════════════════════
   17. CSV EXPORT
════════════════════════════════════════════════════════ */
function exportCSV() {
  const rate = parseFloat($('rateInput')?.value || 45);
  const rows = [['Timestamp','Voltage (V)','Current (A)','Power (W)','Energy (kWh)','Cost (LKR)']];
  state.realtimeBuffer.forEach((power) => {
    rows.push([new Date().toISOString(), fmt(state.voltage,2), fmt(state.current,3),
               fmt(power,1), fmt(state.energy,4), fmt(state.energy*rate,2)]);
  });
  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url; a.download = `wattsons_${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ════════════════════════════════════════════════════════
   18. LOGOUT
════════════════════════════════════════════════════════ */
async function logout() {
  try {
    await WattsonsAuth.auth().signOut();
    window.location.href = 'login.html';
  } catch (e) {
    console.error('Logout error:', e);
    window.location.href = 'login.html';
  }
}

/* ════════════════════════════════════════════════════════
   19. BIND ALL EVENTS
════════════════════════════════════════════════════════ */
function bindEvents() {
  // Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      switchSection(item.dataset.section);
      if (window.innerWidth <= 768) $('sidebar')?.classList.remove('open');
    });
  });

  // Theme
  $('themeToggle')?.addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light');
  });
  $('darkModeToggle')?.addEventListener('change', e => applyTheme(e.target.checked));

  // Menu
  $('menuToggle')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));

  // Export
  $('exportBtn')?.addEventListener('click', exportCSV);

  // Logout buttons
  $('logoutBtn')?.addEventListener('click', logout);
  $('logoutFullBtn')?.addEventListener('click', logout);

  // Alerts
  $('clearAlerts')?.addEventListener('click', () => {
    state.alertLog = []; renderAlertLog(); updateAlertBadge();
  });

  // Alert filters
  document.querySelectorAll('.af-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.af-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.alertFilter = btn.dataset.filter;
      renderAlertLog();
    });
  });

  // Rate input live update
  $('rateInput')?.addEventListener('input', updateBilling);

  // Save settings
  $('saveSettingsBtn')?.addEventListener('click', saveSettings);

  // Analytics tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const key  = tab.dataset.chart;
      const data = key === 'hourly' ? state.hourlyData : key === 'daily' ? state.dailyData : state.weeklyData;
      const c    = charts.usageLine; if (!c) return;
      c.data.labels = data.map(d => d.label);
      c.data.datasets[0].data = data.map(d => d.value);
      c.update();
    });
  });
}

/* ════════════════════════════════════════════════════════
   20. MAIN TICK LOOP
════════════════════════════════════════════════════════ */
function tick() {
  if (DEMO_MODE && !state.liveData) generateReading();
  if (!DEMO_MODE && state.lastReadingReceivedAt
      && Date.now() - state.lastReadingReceivedAt > 15000) {
    state.sensorConnected = false;
    state.liveData = false;
    state.voltage = 0;
    state.current = 0;
    state.power = 0;
    state.powerFactor = 0;
    state.lastReadingTime = null;
    state.realtimeBuffer = [];
    Object.values(deviceStates).forEach(device => {
      device.on = false;
      device.currentPower = 0;
      device.confidence = 0;
    });
  }
  updateCards();
  if (DEMO_MODE || (state.sensorConnected && state.liveData)) updateRealtimeChart();
  updateLoadPanel();
  updateStatusBar();
  checkAlerts();
  updateBilling();
  // If devices page is open, refresh it
  if ($('sec-devices')?.classList.contains('active')) renderDevicesPage();
}

/* ════════════════════════════════════════════════════════
   21. INIT DASHBOARD (called after auth)
════════════════════════════════════════════════════════ */
function initDashboard(user) {

  // Hide auth overlay with fade
  const overlay = $('authOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 500);
  }

  // Display user info
  const email   = user.email || 'user@wattsons.io';
  const initial = email[0].toUpperCase();
  if ($('userAvatar'))       $('userAvatar').textContent       = initial;
  if ($('userEmail'))        $('userEmail').textContent        = email;
  if ($('userEmailSettings'))$('userEmailSettings').textContent = email;
  if ($('authModeLabel'))    $('authModeLabel').textContent     = DEMO_MODE ? 'Demo Mode' : 'Firebase';

  // Load + apply saved settings
  loadSettingsIntoUI();

  // Generate historical data
  generateHistoricalData();

  // Clock
  updateClock();
  setInterval(updateClock, 1000);

  // Init realtime chart
  initRealtimeChart();

  // Replace simulated readings with the ESP32 Firebase stream.
  startFirebaseReadings();

  // Bind events
  bindEvents();

  // Keep simulated values limited to demo mode.
  if (DEMO_MODE) {
    for (let i = 0; i < 30; i++) {
      generateReading();
      state.realtimeBuffer.push(state.power);
    }
    if (state.realtimeBuffer.length > 30)
      state.realtimeBuffer.splice(0, state.realtimeBuffer.length - 30);
  }

  // First tick
  tick();
  setInterval(tick, 2000);

  // Welcome alert
  setTimeout(() => {
    addAlert(`Dashboard ready — monitoring ${email}`, 'info', new Date().toLocaleTimeString());
  }, 1000);

  console.log('%c⚡ Wattsons v2 ready | User:', 'color:#00d4ff;font-weight:bold', email);
}

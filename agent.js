const si = require('systeminformation');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
let config;
try {
  const configPath = path.join(__dirname, 'config.json');
  const rawConfig = fs.readFileSync(configPath);
  config = JSON.parse(rawConfig);
} catch (e) {
  console.error('Erreur: Impossible de lire le fichier config.json.', e);
  console.error('Veuillez exécuter "bash install.sh" pour configurer l\'agent.');
  process.exit(1);
}

const { COLLECTOR_URL, SERVER_ID, API_KEY } = config;

if (!COLLECTOR_URL || !SERVER_ID || !API_KEY) {
  console.error('Erreur: config.json est incomplet. Relancez "bash install.sh".');
  process.exit(1);
}

const POST_URL = `${COLLECTOR_URL}/${SERVER_ID}`; // CORRIGÉ
const COLLECTION_INTERVAL_MS = 10000; // 10 secondes

// --- Logique de collecte ---
async function collectAndSendMetrics() {
  console.log(`[${new Date().toISOString()}] Collecte des métriques...`); // CORRIGÉ

  try {
    const [cpuData, memData, fsData, netData] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats('default')
    ]);

    const mainFs = fsData[0] || { use: 0 };
    const payload = {
      cpu_load: parseFloat(cpuData.currentLoad.toFixed(2)),
      ram_usage_percent: parseFloat(((memData.used / memData.total) * 100).toFixed(2)),
      disk_usage_percent: parseFloat(mainFs.use.toFixed(2)),
      network_rx_sec: parseFloat(netData[0].rx_sec.toFixed(2)) || 0,
      network_tx_sec: parseFloat(netData[0].tx_sec.toFixed(2)) || 0
    };

    console.log(`[${new Date().toISOString()}] Envoi vers ${POST_URL}`); // CORRIGÉ

    const response = await fetch(POST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}` // CORRIGÉ
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Erreur HTTP: ${response.status} ${response.statusText}`); // CORRIGÉ
    }
    console.log(`[${new Date().toISOString()}] Données envoyées.`); // CORRIGÉ

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erreur:`, error.message); // CORRIGÉ
  }
}

// --- Démarrage de l'agent ---
console.log('Agent de monitoring Registre démarré.');
console.log(`Envoi des données toutes les ${COLLECTION_INTERVAL_MS / 1000} secondes.`); // CORRIGÉ
collectAndSendMetrics();
setInterval(collectAndSendMetrics, COLLECTION_INTERVAL_MS);

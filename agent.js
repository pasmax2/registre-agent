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

const POST_URL = `${COLLECTOR_URL}/${SERVER_ID}`;
const COLLECTION_INTERVAL_MS = 10000; // 10 secondes

// Fonction helper pour sécuriser les valeurs
const safeNumber = (value, defaultValue = 0) => {
  if (value === null || value === undefined || isNaN(value)) {
    return defaultValue;
  }
  return Number(value);
};

// Fonction helper pour arrondir avec sécurité
const safeRound = (value, decimals = 2) => {
  const num = safeNumber(value, 0);
  return parseFloat(num.toFixed(decimals));
};

// --- Logique de collecte ---
async function collectAndSendMetrics() {
  console.log(`[${new Date().toISOString()}] Collecte des métriques...`);

  try {
    // --- MODIFICATION 1 : Séparer les appels ---
    // 1. Collecter CPU, RAM, Disque
    const [cpuData, memData, fsData] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize()
    ]);

    // 2. Trouver dynamiquement l'interface réseau par défaut
    // (Ceci trouve le nom, ex: 'eth0' ou 'ens18')
    const defaultIfaceName = await si.networkInterfaceDefault();
    console.log(`[${new Date().toISOString()}] Interface réseau détectée: ${defaultIfaceName}`);

    // 3. Collecter les stats pour CETTE interface
    // (si.networkStats renvoie un tableau, même pour une seule interface)
    const netStatsArray = await si.networkStats(defaultIfaceName);
    // --- FIN DES MODIFICATIONS 1 ---

    // Extraire les données avec fallbacks
    const cpuLoad = safeNumber(cpuData?.currentLoad, 0);
    
    const memTotal = safeNumber(memData?.total, 1); // Éviter division par zéro
    // Calcul de la RAM "réelle" (Totale - Disponible)
    const memAvailable = safeNumber(memData?.available, 0); 
    const memUsed = (memTotal - memAvailable); 
    const ramUsagePercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
    
    const mainFs = Array.isArray(fsData) && fsData.length > 0 ? fsData[0] : { use: 0 };
    const diskUsagePercent = safeNumber(mainFs?.use, 0);
    
    // --- MODIFICATION 2 : Utiliser les stats réseau ---
    const mainNet = Array.isArray(netStatsArray) && netStatsArray.length > 0 ? netStatsArray[0] : { rx_sec: 0, tx_sec: 0 };
    const networkRxSec = safeNumber(mainNet?.rx_sec, 0);
    const networkTxSec = safeNumber(mainNet?.tx_sec, 0);
    // --- FIN DES MODIFICATIONS 2 ---

    // Construire le payload avec des valeurs arrondies
    const payload = {
      cpu_load: safeRound(cpuLoad),
      ram_usage_percent: safeRound(ramUsagePercent),
      disk_usage_percent: safeRound(diskUsagePercent),
      network_rx_sec: safeRound(networkRxSec),
      network_tx_sec: safeRound(networkTxSec)
    };

    // Log pour debug
    console.log(`[${new Date().toISOString()}] Métriques collectées:`, payload);
    console.log(`[${new Date().toISOString()}] Envoi vers ${POST_URL}`);

    const response = await fetch(POST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erreur HTTP: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    console.log(`[${new Date().toISOString()}] ✅ Données envoyées avec succès.`);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Erreur:`, error.message);
    
    // En cas d'erreur réseau, ne pas planter l'agent
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.error('Impossible de joindre le serveur. Nouvelle tentative dans 10 secondes...');
    }
  }
}

// --- Démarrage de l'agent ---
console.log('═══════════════════════════════════════════════════════');
console.log('🚀 Agent de monitoring Registre démarré');
console.log(`📊 Intervalle de collecte: ${COLLECTION_INTERVAL_MS / 1000} secondes`);
console.log(`🌐 Serveur: ${POST_URL}`);
console.log('═══════════════════════════════════════════════════════');

// Première collecte immédiate
collectAndSendMetrics();

// Puis collectes régulières
setInterval(collectAndSendMetrics, COLLECTION_INTERVAL_MS);

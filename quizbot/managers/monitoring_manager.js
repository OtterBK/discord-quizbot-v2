const os = require('os');
const fs = require('fs');
const path = require('path');
const { sync_objects } = require('./ipc_manager.js');
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const logger = require('../../utility/logger.js')('MonitoringManager');

function getLogFilePath()
{
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return path.join(SYSTEM_CONFIG.LOG_PATH, `monitoring_log_${year}_${month}_${day}.csv`);
}

let cpu_usage_history = [];

function getCpuUsage()
{
  const cpus = os.cpus();
  let total_idle = 0, total_tick = 0;

  cpus.forEach((core) =>
  {
    for (const type in core.times)
    {
      total_tick += core.times[type];
    }
    total_idle += core.times.idle;
  });

  const idle = total_idle / cpus.length;
  const total = total_tick / cpus.length;

  return ((1 - idle / total) * 100).toFixed(2); // Convert to percentage
}

function getMemoryUsage()
{
  const total_memory = os.totalmem();
  const free_memory = os.freemem();
  const used_memory = total_memory - free_memory;
  return ((used_memory / total_memory) * 100).toFixed(2); // Convert to percentage
}

function calculateAverageCpuUsage()
{
  const now = Date.now();

  // Filter the history to keep only relevant entries within the average duration
  cpu_usage_history = cpu_usage_history.filter(entry => now - entry.timestamp <= SYSTEM_CONFIG.MONITORING_AVERAGE_DURATION);

  // Ensure enough history is available to calculate an average
  if (cpu_usage_history.length === 0 || (now - cpu_usage_history[0].timestamp) < SYSTEM_CONFIG.MONITORING_AVERAGE_DURATION)
  {
    return null;
  }

  // Calculate the average CPU usage
  const sum = cpu_usage_history.reduce((acc, entry) => acc + entry.usage, 0);
  return (sum / cpu_usage_history.length).toFixed(2);
}

function logCpuUsageToFile(cpu_usage, memory_usage)
{       
  const now = new Date();
  const time = now.toLocaleString(); // Human-readable format
  const log_entry = `${time},${cpu_usage},${memory_usage},${sync_objects.get('local_play_count')},${sync_objects.get('multi_play_count')}\n`;
  const log_file_path = getLogFilePath();

  // Write header if file does not exist
  if (!fs.existsSync(log_file_path))
  {
    fs.writeFileSync(log_file_path, 'TIME,CPU_USAGE,MEMORY,TOTAL_SESSION,MULTIPLAYER_SESSION\n', 'utf8');
  }

  // Append the log entry
  fs.appendFileSync(log_file_path, log_entry, 'utf8');
}

function monitorCpuUsage()
{
  const cpu_usage = parseFloat(getCpuUsage());
  const memory_usage = parseFloat(getMemoryUsage());

  cpu_usage_history.push({ timestamp: Date.now(), usage: cpu_usage });

  // Remove history entries older than the average duration
  cpu_usage_history = cpu_usage_history.filter(entry => Date.now() - entry.timestamp <= SYSTEM_CONFIG.MONITORING_AVERAGE_DURATION);

  const average_usage = calculateAverageCpuUsage();

  logCpuUsageToFile(cpu_usage, memory_usage);

  if (average_usage !== null && average_usage > SYSTEM_CONFIG.MONITORING_CPU_USAGE_THRESHOLD)
  {
    logger.warn(`WARNING: Average CPU usage (${average_usage}%) exceeded the threshold (${SYSTEM_CONFIG.MONITORING_CPU_USAGE_THRESHOLD}%).`);
  }
}

// Start monitoring at the specified interval
function startMonitoring()
{
  setInterval(monitorCpuUsage, SYSTEM_CONFIG.MONITORING_CHECK_INTERVAL);
}

module.exports = { startMonitoring }; 

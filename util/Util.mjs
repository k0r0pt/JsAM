export function getMemoryFootprint() {
  var footprint = {};
  for (const [key, value] of Object.entries(process.memoryUsage())) {
    footprint[key] = `${value / (1024 * 1024)} MB`;
  }
  return footprint;
}

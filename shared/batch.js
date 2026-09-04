export async function mapInBatches(items, batchSize, mapper) {
  const size = Math.max(1, Math.floor(batchSize));
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    const batch = items.slice(index, index + size);
    results.push(...(await Promise.all(batch.map(mapper))));
  }
  return results;
}

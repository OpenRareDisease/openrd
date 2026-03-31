export interface TimelineDetailItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  tag: string;
  documentId?: string | null;
}

const detailCache = new Map<string, TimelineDetailItem>();

export const storeTimelineDetailItem = (item: TimelineDetailItem) => {
  const detailId = `${item.id}:${item.timestamp}`;
  detailCache.set(detailId, item);

  if (detailCache.size > 80) {
    const oldestKey = detailCache.keys().next().value;
    if (typeof oldestKey === 'string') {
      detailCache.delete(oldestKey);
    }
  }

  return detailId;
};

export const getTimelineDetailItem = (detailId: string) => detailCache.get(detailId) ?? null;

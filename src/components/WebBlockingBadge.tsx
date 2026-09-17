import React, { useEffect, useState } from 'react';
import { getWebBlockingStatus, type WebBlockingStatus } from '../lib/storage';

export default function WebBlockingBadge({ partition }: { partition: string }) {
  const [status, setStatus] = useState<WebBlockingStatus | null>(null);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    setStatus(null);
    const refresh = async () => {
      try {
        const next = await getWebBlockingStatus(partition);
        if (!disposed) setStatus(next);
      } catch { if (!disposed) setStatus(null); }
      if (!disposed) timer = setTimeout(refresh, 1500);
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [partition]);
  const date = status?.filtersUpdatedAt ? new Date(status.filtersUpdatedAt).toLocaleDateString() : '';
  return <span data-web-blocking-status="true" className="whitespace-nowrap text-[10px] font-semibold normal-case tracking-normal"
    title={status ? `This Web session: ${status.ads} ad/tracker requests, ${status.cookies} cookie operations, ${status.popups} popups blocked. ${status.filterRules.toLocaleString()} filter rules, updated ${date}.` : 'Reading blocker status…'}>
    {status ? `${status.ads} blocked` : '…'}
  </span>;
}

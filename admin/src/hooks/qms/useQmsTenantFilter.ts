import { useEffect, useState } from "react";

export const QMS_TENANT_STORAGE_KEY = "qms_selected_tenant_id";
export const QMS_TENANT_CHANGE_EVENT = "qms-tenant-change";

export function getStoredQmsTenantId(): string {
  return localStorage.getItem(QMS_TENANT_STORAGE_KEY) || "";
}

export function setStoredQmsTenantId(tenantId: string): void {
  if (tenantId) {
    localStorage.setItem(QMS_TENANT_STORAGE_KEY, tenantId);
  } else {
    localStorage.removeItem(QMS_TENANT_STORAGE_KEY);
  }

  window.dispatchEvent(new Event(QMS_TENANT_CHANGE_EVENT));
}

export function useQmsTenantFilter(): string {
  const [tenantId, setTenantId] = useState(getStoredQmsTenantId);

  useEffect(() => {
    const handleChange = () => {
      setTenantId(getStoredQmsTenantId());
    };

    window.addEventListener(QMS_TENANT_CHANGE_EVENT, handleChange);
    window.addEventListener("storage", handleChange);

    return () => {
      window.removeEventListener(QMS_TENANT_CHANGE_EVENT, handleChange);
      window.removeEventListener("storage", handleChange);
    };
  }, []);

  return tenantId;
}

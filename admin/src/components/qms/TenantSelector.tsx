import { useEffect, useMemo, useState } from "react";
import { Select, Space, Tag, Typography } from "antd";
import { adminApi } from "../../api";
import {
  setStoredQmsTenantId,
  useQmsTenantFilter,
} from "../../hooks/qms";

interface Enterprise {
  id: number;
  name: string;
  code: string;
}

interface AdminUser {
  role?: string;
  tenant_id?: string | null;
}

interface EnterprisesResponse {
  success: boolean;
  data?: Enterprise[];
}

function isEnterprisesResponse(value: unknown): value is EnterprisesResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as Partial<EnterprisesResponse>;
  return response.success === true;
}

function getAdminUser(): AdminUser {
  try {
    const user = JSON.parse(localStorage.getItem("admin_user") || "{}");
    return user && typeof user === "object" ? user : {};
  } catch {
    return {};
  }
}

export default function TenantSelector() {
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [loading, setLoading] = useState(false);
  const tenantId = useQmsTenantFilter();
  const user = useMemo(() => getAdminUser(), []);
  const isSuperAdmin = user.role === "SUPER_ADMIN";

  useEffect(() => {
    if (!isSuperAdmin) {
      return;
    }

    const loadEnterprises = async () => {
      setLoading(true);
      try {
        const response: unknown = await adminApi.getEnterprises();
        if (isEnterprisesResponse(response)) {
          setEnterprises(response.data || []);
        }
      } finally {
        setLoading(false);
      }
    };

    loadEnterprises();
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return null;
  }

  return (
    <Space size={8}>
      <Typography.Text type="secondary">租户</Typography.Text>
      <Select
        value={tenantId || ""}
        loading={loading}
        style={{ width: 240 }}
        options={[
          { value: "", label: "全部租户" },
          ...enterprises.map((enterprise) => ({
            value: enterprise.code,
            label: `${enterprise.name} (${enterprise.code})`,
          })),
        ]}
        onChange={(value) => setStoredQmsTenantId(value)}
        placeholder="全部租户"
        showSearch
        optionFilterProp="label"
      />
      {tenantId && <Tag>{tenantId}</Tag>}
    </Space>
  );
}

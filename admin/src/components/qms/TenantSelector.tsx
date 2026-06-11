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
        const response = await adminApi.getEnterprises();
        if ((response as any).success) {
          setEnterprises((response as any).data || []);
        }
      } finally {
        setLoading(false);
      }
    };

    loadEnterprises();
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <Space size={6}>
        <Typography.Text type="secondary">QMS 租户</Typography.Text>
        <Tag color="blue">{user.tenant_id || "未绑定"}</Tag>
      </Space>
    );
  }

  return (
    <Space size={8}>
      <Typography.Text type="secondary">QMS 租户</Typography.Text>
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

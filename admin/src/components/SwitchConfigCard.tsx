import React, { useEffect, useState } from "react";
import { Card, Switch, Button, Select, Input, Typography, Form, message } from "antd";

const { Text } = Typography;

export type SchemaField =
  | { kind: "protocol"; name: string; label: string }
  | { kind: "text"; name: string; label: string; placeholder?: string }
  | { kind: "secret"; name: string; label: string; placeholder?: string };

export interface SwitchConfigCardValue {
  enabled: number;
  [key: string]: unknown;
}

export interface SwitchConfigCardProps {
  title: string;
  description: string;
  value: SwitchConfigCardValue;
  schema: SchemaField[];
  onSave: (payload: SwitchConfigCardValue) => Promise<void>;
  secretFieldsSet?: Record<string, boolean>;
}

const SwitchConfigCard: React.FC<SwitchConfigCardProps> = ({
  title,
  description,
  value,
  schema,
  onSave,
  secretFieldsSet,
}) => {
  const [enabled, setEnabled] = useState<boolean>(value.enabled === 1);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of schema) {
      const v = value[f.name];
      initial[f.name] = typeof v === "string" ? v : "";
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(value.enabled === 1);
    const next: Record<string, string> = {};
    for (const f of schema) {
      const v = value[f.name];
      next[f.name] = typeof v === "string" ? v : "";
    }
    setFieldValues(next);
  }, [value, schema]);

  const setField = (name: string, v: string) => {
    setFieldValues((prev) => ({ ...prev, [name]: v }));
  };

  const handleSave = async () => {
    if (enabled) {
      for (const f of schema) {
        if (f.kind === "protocol") {
          const v = fieldValues[f.name];
          if (v !== "http" && v !== "https") {
            message.error(`${f.label} 必须为 http 或 https`);
            return;
          }
        } else if (f.kind === "secret") {
          const v = (fieldValues[f.name] || "").trim();
          if (!v && secretFieldsSet?.[f.name] !== true) {
            message.error(`${f.label} 必填且非空`);
            return;
          }
        } else {
          const v = (fieldValues[f.name] || "").trim();
          if (!v) {
            message.error(`${f.label} 必填且非空`);
            return;
          }
        }
      }
    }
    const payload: SwitchConfigCardValue = { enabled: enabled ? 1 : 0 };
    for (const f of schema) {
      payload[f.name] = fieldValues[f.name] || "";
    }
    setSaving(true);
    try {
      await onSave(payload);
      message.success(`${title} 已保存`);
    } catch (e: any) {
      message.error(e?.response?.data?.msg || e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={title} style={{ maxWidth: 760, marginTop: 16 }}>
      <Text type="secondary">{description}</Text>
      <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 12 }}>
        <Switch checked={enabled} onChange={setEnabled} />
        <span>{enabled ? "已开启" : "已关闭"}</span>
      </div>
      {enabled && (
        <Form layout="vertical" style={{ marginTop: 22 }}>
          {schema.map((f) =>
            f.kind === "protocol" ? (
              <Form.Item key={f.name} label={f.label} required>
                <Select
                  value={fieldValues[f.name] || undefined}
                  onChange={(v) => setField(f.name, v)}
                  options={[
                    { value: "http", label: "http" },
                    { value: "https", label: "https" },
                  ]}
                  placeholder="选择协议类型"
                  style={{ maxWidth: 240 }}
                />
              </Form.Item>
            ) : f.kind === "secret" ? (
              <Form.Item
                key={f.name}
                label={f.label}
                required={!secretFieldsSet?.[f.name]}
              >
                <Input.Password
                  value={fieldValues[f.name] || ""}
                  onChange={(e) => setField(f.name, e.target.value)}
                  placeholder={
                    secretFieldsSet?.[f.name]
                      ? "已设置（留空则不修改）"
                      : f.placeholder ?? ""
                  }
                  style={{ maxWidth: 420 }}
                />
              </Form.Item>
            ) : (
              <Form.Item key={f.name} label={f.label} required>
                <Input
                  value={fieldValues[f.name] || ""}
                  onChange={(e) => setField(f.name, e.target.value)}
                  placeholder={f.placeholder || ""}
                  style={{ maxWidth: 420 }}
                />
              </Form.Item>
            ),
          )}
        </Form>
      )}
      <div style={{ marginTop: 22, textAlign: "right" }}>
        <Button type="primary" loading={saving} onClick={handleSave}>
          保存设置
        </Button>
      </div>
    </Card>
  );
};

export default SwitchConfigCard;

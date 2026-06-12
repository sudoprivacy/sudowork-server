/**
 * Alerts configuration page
 */

import React, { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Switch,
  Tag,
  Space,
  message,
  Popconfirm,
  Tabs,
  Spin,
  Tooltip,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { api } from "../../api/qms/client";
import type { AlertConfig, AlertHistory, AlertLevel, AlertType, AlertChannel, AlertComparison } from "../../api/qms/types";

const alertLevels: AlertLevel[] = ["info", "warning", "critical"];
const alertTypes: AlertType[] = ["perf", "error", "conversation", "install", "crash"];
const alertChannels: AlertChannel[] = ["lark", "email"];
const alertComparisons: AlertComparison[] = ["gt", "gte", "lt", "lte", "eq", "neq"];

const levelColors: Record<AlertLevel, string> = {
  info: "blue",
  warning: "orange",
  critical: "red",
};

const comparisonLabels: Record<AlertComparison, string> = {
  gt: "大于",
  gte: "大于等于",
  lt: "小于",
  lte: "小于等于",
  eq: "等于",
  neq: "不等于",
};

const channelLabels: Record<AlertChannel, string> = {
  lark: "飞书",
  email: "邮件",
};

export default function Alerts() {
  const [configs, setConfigs] = useState<AlertConfig[]>([]);
  const [history, setHistory] = useState<AlertHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AlertConfig | null>(null);
  const [form] = Form.useForm();

  const fetchConfigs = async () => {
    try {
      const result = await api.getAlertConfigs();
      setConfigs(result);
    } catch (err) {
      console.error("Failed to fetch alert configs:", err);
    }
  };

  const fetchHistory = async () => {
    try {
      const result = await api.getAlertHistory();
      setHistory(result.data);
    } catch (err) {
      console.error("Failed to fetch alert history:", err);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchConfigs(), fetchHistory()]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleRefresh();
  }, []);

  const handleCreate = () => {
    setEditingConfig(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (config: AlertConfig) => {
    setEditingConfig(config);
    form.setFieldsValue({
      name: config.name,
      type: config.type,
      metric: config.metric,
      threshold: config.threshold,
      comparison: config.comparison,
      level: config.level,
      channels: config.channels,
      enabled: config.enabled,
      cooldown_minutes: config.cooldown_minutes,
      description: config.description,
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteAlertConfig(id);
      message.success("删除成功");
      fetchConfigs();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleTest = async (id: string) => {
    try {
      await api.testAlertConfig(id);
      message.success("测试告警已发送");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "测试失败");
    }
  };

  const handleSubmit = async (values: Partial<AlertConfig>) => {
    try {
      if (editingConfig) {
        await api.updateAlertConfig(editingConfig.id, values);
        message.success("更新成功");
      } else {
        await api.createAlertConfig(values);
        message.success("创建成功");
      }
      setModalVisible(false);
      fetchConfigs();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const handleAcknowledge = async (id: number) => {
    try {
      await api.acknowledgeAlert(id);
      message.success("已确认");
      fetchHistory();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "确认失败");
    }
  };

  const configColumns = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      render: (type: AlertType) => <Tag>{type}</Tag>,
    },
    {
      title: "指标",
      dataIndex: "metric",
      key: "metric",
    },
    {
      title: "阈值",
      dataIndex: "threshold",
      key: "threshold",
      render: (threshold: number, record: AlertConfig) =>
        `${comparisonLabels[record.comparison]} ${threshold}`,
    },
    {
      title: "级别",
      dataIndex: "level",
      key: "level",
      render: (level: AlertLevel) => (
        <Tag color={levelColors[level]}>{level}</Tag>
      ),
    },
    {
      title: "通知渠道",
      dataIndex: "channels",
      key: "channels",
      render: (channels: AlertChannel[]) =>
        channels.map((c) => <Tag key={c}>{channelLabels[c]}</Tag>),
    },
    {
      title: "状态",
      dataIndex: "enabled",
      key: "enabled",
      render: (enabled: boolean) => (
        <Tag color={enabled ? "green" : "default"}>
          {enabled ? "启用" : "禁用"}
        </Tag>
      ),
    },
    {
      title: "冷却时间",
      dataIndex: "cooldown_minutes",
      key: "cooldown_minutes",
      render: (minutes: number) => `${minutes}分钟`,
    },
    {
      title: "操作",
      key: "actions",
      render: (_: unknown, record: AlertConfig) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          {false && (
            <Button
              type="link"
              icon={<PlayCircleOutlined />}
              onClick={() => handleTest(record.id)}
            />
          )}
          <Popconfirm
            title="确定删除此告警配置?"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const historyColumns = [
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
    },
    {
      title: "级别",
      dataIndex: "level",
      key: "level",
      render: (level: AlertLevel) => (
        <Tag color={levelColors[level]}>{level}</Tag>
      ),
    },
    {
      title: "发送时间",
      dataIndex: "sent_at",
      key: "sent_at",
      render: (time: number) => new Date(time).toLocaleString(),
    },
    {
      title: "状态",
      dataIndex: "success",
      key: "success",
      render: (success: boolean, record: AlertHistory) => {
        // Build tooltip content showing each channel status
        const tooltipContent = record.channel_results
          ? record.channel_results.map((r) => (
              <div key={r.channel} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {r.success ? (
                  <CheckCircleOutlined style={{ color: "#52c41a" }} />
                ) : (
                  <CloseCircleOutlined style={{ color: "#f5222d" }} />
                )}
                <span>{channelLabels[r.channel]}</span>
                {!r.success && r.error && (
                  <span style={{ color: "#f5222d", fontSize: 12 }}>({r.error})</span>
                )}
              </div>
            ))
          : success
            ? record.channels.map((c) => (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <CheckCircleOutlined style={{ color: "#52c41a" }} />
                  <span>{channelLabels[c]}</span>
                </div>
              ))
            : (
              <div style={{ color: "#f5222d" }}>
                {record.error_message || "发送失败"}
              </div>
            );

        return (
          <Tooltip title={<div style={{ padding: 4 }}>{tooltipContent}</div>} placement="top">
            <Tag color={success ? "green" : "red"}>
              {success ? "成功" : "失败"}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "确认",
      dataIndex: "acknowledged",
      key: "acknowledged",
      render: (acknowledged: boolean, record: AlertHistory) =>
        acknowledged ? (
          <Tag color="green">已确认</Tag>
        ) : (
          <Button
            type="link"
            size="small"
            onClick={() => handleAcknowledge(record.id)}
          >
            确认
          </Button>
        ),
    },
    {
      title: "渠道",
      dataIndex: "channels",
      key: "channels",
      render: (channels: AlertChannel[]) =>
        channels.map((c) => <Tag key={c}>{channelLabels[c]}</Tag>),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: "right" }}>
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={handleRefresh}
        >
          刷新
        </Button>
      </div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 100 }}>
          <Spin size="large" />
        </div>
      ) : (
        <Tabs
          items={[
            {
              key: "configs",
              label: "告警配置",
              icon: <BellOutlined />,
              children: (
                <Card
                  title="告警配置列表"
                  extra={
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={handleCreate}
                    >
                      新建告警
                    </Button>
                  }
                >
                  <Table
                    dataSource={configs}
                    columns={configColumns}
                    rowKey="id"
                    pagination={false}
                  />
                </Card>
              ),
            },
            {
              key: "history",
              label: "告警历史",
              children: (
                <Card title="告警历史记录">
                  <Table
                    dataSource={history}
                    columns={historyColumns}
                    rowKey="id"
                    pagination={{ pageSize: 20 }}
                  />
                </Card>
              ),
            },
          ]}
        />
      )}

      <Modal
        title={editingConfig ? "编辑告警" : "新建告警"}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="告警名称"
            rules={[{ required: true, message: "请输入告警名称" }]}
          >
            <Input placeholder="例如: 高错误率告警" />
          </Form.Item>

          <Form.Item
            name="type"
            label="告警类型"
            rules={[{ required: true, message: "请选择告警类型" }]}
          >
            <Select options={alertTypes.map((t) => ({ value: t, label: t }))} />
          </Form.Item>

          <Form.Item
            name="metric"
            label="监控指标"
            rules={[{ required: true, message: "请输入监控指标" }]}
          >
            <Input placeholder="例如: error_rate, avg_duration" />
          </Form.Item>

          <Form.Item
            name="threshold"
            label="阈值"
            rules={[{ required: true, message: "请输入阈值" }]}
          >
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            name="comparison"
            label="比较方式"
            rules={[{ required: true, message: "请选择比较方式" }]}
          >
            <Select
              options={alertComparisons.map((c) => ({
                value: c,
                label: comparisonLabels[c],
              }))}
            />
          </Form.Item>

          <Form.Item
            name="level"
            label="告警级别"
            rules={[{ required: true, message: "请选择告警级别" }]}
          >
            <Select
              options={alertLevels.map((l) => ({ value: l, label: l }))}
            />
          </Form.Item>

          <Form.Item
            name="channels"
            label="通知渠道"
            rules={[{ required: true, message: "请选择通知渠道" }]}
          >
            <Select
              mode="multiple"
              options={alertChannels.map((c) => ({ value: c, label: channelLabels[c] }))}
            />
          </Form.Item>

          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item name="cooldown_minutes" label="冷却时间(分钟)">
            <InputNumber min={1} max={120} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="告警描述信息" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

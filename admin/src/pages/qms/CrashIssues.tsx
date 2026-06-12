/**
 * Crash Issues page
 */

import React, { useState, useEffect } from "react";
import { Card, Table, Tag, Select, Spin, Button, Modal, Descriptions, Tabs, message } from "antd";
import { ReloadOutlined, CheckCircleOutlined, StopOutlined } from "@ant-design/icons";
import { api } from "../../api/qms/client";
import { useQmsTenantFilter } from "../../hooks/qms";
import type { CrashIssue, CrashEvent } from "../../api/qms/types";

const levelColors: Record<string, string> = {
  fatal: "red",
  error: "orange",
  warning: "blue",
};

const statusColors: Record<string, string> = {
  unresolved: "red",
  resolved: "green",
  ignored: "default",
};

const typeLabels: Record<string, string> = {
  native_crash: "原生 Crash",
  renderer_crash: "渲染进程 Crash",
  js_exception: "JS 异常",
};

export default function CrashIssues() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CrashIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [levelFilter, setLevelFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [selectedIssue, setSelectedIssue] = useState<(CrashIssue & { events: CrashEvent[] }) | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const tenantFilter = useQmsTenantFilter();

  useEffect(() => {
    fetchData();
  }, [levelFilter, statusFilter, typeFilter, tenantFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await api.getCrashIssues({
        level: levelFilter,
        status: statusFilter,
        type: typeFilter,
        limit: 50,
      });
      setData(result.data);
      setTotal(result.total);
    } catch (err) {
      console.error("Failed to fetch crash issues:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetail = async (issue: CrashIssue) => {
    try {
      const detail = await api.getCrashIssue(issue.id);
      setSelectedIssue(detail);
      setDetailModalVisible(true);
    } catch (err) {
      console.error("Failed to fetch issue detail:", err);
    }
  };

  const handleResolve = async (issue: CrashIssue) => {
    try {
      await api.resolveCrashIssue(issue.id);
      message.success("Issue 已标记为已解决");
      fetchData();
    } catch (err) {
      message.error("操作失败");
    }
  };

  const handleIgnore = async (issue: CrashIssue) => {
    try {
      await api.ignoreCrashIssue(issue.id);
      message.success("Issue 已标记为忽略");
      fetchData();
    } catch (err) {
      message.error("操作失败");
    }
  };

  const columns = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 60,
    },
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (title: string) => <span style={{ fontWeight: 500 }}>{title}</span>,
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 120,
      render: (type: string) => (
        <Tag color={type === "native_crash" || type === "renderer_crash" ? "red" : "orange"}>
          {typeLabels[type] || type}
        </Tag>
      ),
    },
    {
      title: "级别",
      dataIndex: "level",
      key: "level",
      width: 80,
      render: (level: string) => (
        <Tag color={levelColors[level] || "default"}>{level}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => (
        <Tag color={statusColors[status] || "default"}>
          {status === "unresolved" ? "未解决" : status === "resolved" ? "已解决" : "已忽略"}
        </Tag>
      ),
    },
    {
      title: "事件数",
      dataIndex: "count",
      key: "count",
      width: 80,
      sorter: true,
    },
    {
      title: "首次发生",
      dataIndex: "first_seen",
      key: "first_seen",
      width: 160,
      render: (time: number) => new Date(time).toLocaleString(),
    },
    {
      title: "最后发生",
      dataIndex: "last_seen",
      key: "last_seen",
      width: 160,
      render: (time: number) => new Date(time).toLocaleString(),
    },
    {
      title: "版本",
      dataIndex: "last_release",
      key: "last_release",
      width: 100,
      render: (release: string) => release || "-",
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_: unknown, record: CrashIssue) => (
        <>
          <Button type="link" size="small" onClick={() => handleViewDetail(record)}>
            详情
          </Button>
          {record.status === "unresolved" && (
            <>
              <Button
                type="link"
                size="small"
                icon={<CheckCircleOutlined />}
                onClick={() => handleResolve(record)}
              >
                解决
              </Button>
              <Button
                type="link"
                size="small"
                icon={<StopOutlined />}
                onClick={() => handleIgnore(record)}
              >
                忽略
              </Button>
            </>
          )}
        </>
      ),
    },
  ];

  const eventColumns = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 60,
    },
    {
      title: "时间",
      dataIndex: "timestamp",
      key: "timestamp",
      width: 160,
      render: (time: number) => new Date(time).toLocaleString(),
    },
    {
      title: "平台",
      dataIndex: "platform",
      key: "platform",
      width: 80,
    },
    {
      title: "进程",
      dataIndex: "process_type",
      key: "process_type",
      width: 80,
    },
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      width: 80,
    },
    {
      title: "消息",
      dataIndex: "error_message",
      key: "error_message",
      ellipsis: true,
      render: (msg: string) => msg || "-",
    },
  ];

  return (
    <div>
      <Card
        title="Crash Issues"
        extra={
          <>
            <Select
              placeholder="类型筛选"
              allowClear
              style={{ width: 130, marginRight: 8 }}
              onChange={setTypeFilter}
              options={[
                { value: "native_crash", label: "原生 Crash" },
                { value: "renderer_crash", label: "渲染进程 Crash" },
                { value: "js_exception", label: "JS 异常" },
              ]}
            />
            <Select
              placeholder="级别筛选"
              allowClear
              style={{ width: 100, marginRight: 8 }}
              onChange={setLevelFilter}
              options={[
                { value: "fatal", label: "fatal" },
                { value: "error", label: "error" },
                { value: "warning", label: "warning" },
              ]}
            />
            <Select
              placeholder="状态筛选"
              allowClear
              style={{ width: 110, marginRight: 8 }}
              onChange={setStatusFilter}
              options={[
                { value: "unresolved", label: "未解决" },
                { value: "resolved", label: "已解决" },
                { value: "ignored", label: "已忽略" },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={fetchData}>
              刷新
            </Button>
          </>
        }
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: 100 }}>
            <Spin size="large" />
          </div>
        ) : (
          <Table
            dataSource={data}
            columns={columns}
            rowKey="id"
            pagination={{
              total,
              pageSize: 50,
            }}
            size="small"
          />
        )}
      </Card>

      <Modal
        title="Issue 详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={900}
      >
        {selectedIssue && (
          <Tabs items={[
            {
              key: "info",
              label: "基本信息",
              children: (
                <Descriptions bordered column={2}>
                  <Descriptions.Item label="Issue ID">{selectedIssue.id}</Descriptions.Item>
                  <Descriptions.Item label="Fingerprint">{selectedIssue.fingerprint.slice(0, 16)}...</Descriptions.Item>
                  <Descriptions.Item label="标题" span={2}>{selectedIssue.title}</Descriptions.Item>
                  <Descriptions.Item label="类型">
                    <Tag color={selectedIssue.type === "native_crash" ? "red" : "orange"}>
                      {typeLabels[selectedIssue.type] || selectedIssue.type}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="级别">
                    <Tag color={levelColors[selectedIssue.level] || "default"}>{selectedIssue.level}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={statusColors[selectedIssue.status] || "default"}>
                      {selectedIssue.status === "unresolved" ? "未解决" : selectedIssue.status === "resolved" ? "已解决" : "已忽略"}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="事件数">{selectedIssue.count}</Descriptions.Item>
                  <Descriptions.Item label="首次发生">{new Date(selectedIssue.first_seen).toLocaleString()}</Descriptions.Item>
                  <Descriptions.Item label="最后发生">{new Date(selectedIssue.last_seen).toLocaleString()}</Descriptions.Item>
                  <Descriptions.Item label="首次版本">{selectedIssue.first_release || "-"}</Descriptions.Item>
                  <Descriptions.Item label="最后版本">{selectedIssue.last_release || "-"}</Descriptions.Item>
                  <Descriptions.Item label="堆栈摘要" span={2}>
                    <pre style={{ fontSize: 12, maxHeight: 200, overflow: "auto", background: "#f5f5f5", padding: 8 }}>
                      {selectedIssue.stack_summary || "无"}
                    </pre>
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: "events",
              label: `事件列表 (${selectedIssue.events.length})`,
              children: (
                <Table
                  dataSource={selectedIssue.events}
                  columns={eventColumns}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 10 }}
                />
              ),
            },
          ]} />
        )}
      </Modal>
    </div>
  );
}

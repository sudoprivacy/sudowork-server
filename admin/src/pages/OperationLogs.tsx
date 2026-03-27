import React, { useState, useEffect } from "react";
import {
  Card,
  Table,
  Tag,
  Typography,
  Select,
  DatePicker,
  Space,
  Button,
  Modal,
  Descriptions,
} from "antd";
import { adminApi } from "../api";
import dayjs from "dayjs";

const { Title } = Typography;
const { RangePicker } = DatePicker;

interface OperationLog {
  id: number;
  user_id: number;
  user_phone: string;
  action: string;
  resource: string;
  resource_id: number;
  method: string;
  path: string;
  params: string;
  request_data: string;
  response_data: string;
  response_status: number;
  ip_address: string;
  duration_ms: number;
  error_message: string;
  created_at: string;
}

const actionLabels: Record<string, string> = {
  AUTH_LOGIN: "用户登录",
  AUTH_LOGOUT: "用户登出",
  AUTH_SEND_CODE: "发送验证码",
  INVITATION_CODE_CREATE: "创建邀请码",
  INVITATION_CODE_DELETE: "删除邀请码",
  USER_CREATE: "创建用户",
  USER_UPDATE: "更新用户",
  USER_DELETE: "删除用户",
  USER_PROFILE_UPDATE: "更新资料",
  USER_LEDGER_QUERY: "查询流水",
  POINTS_SYNC: "积分同步",
  POINTS_CONSUME: "积分消耗",
  POINTS_RECHARGE: "积分充值",
  POINTS_REFUND: "积分退款",
  SUDOROUTER_CREATE_USER: "创建 Sudorouter 用户",
  SUDOROUTER_CREATE_USER_FAILED: "创建 Sudorouter 用户失败",
  SUDOROUTER_CREATE_TOKEN: "创建 Sudorouter 令牌",
  SUDOROUTER_CREATE_TOKEN_FAILED: "创建 Sudorouter 令牌失败",
  SUDOROUTER_UPDATE_QUOTA: "更新 Sudorouter 额度",
  SUDOROUTER_TOKEN_CREATE: "创建 Sudorouter 令牌",
  SUDOROUTER_QUOTA_SYNC: "同步额度",
};

const actionColors: Record<string, string> = {
  SUDOROUTER_CREATE_USER: "purple",
  SUDOROUTER_CREATE_USER_FAILED: "red",
  SUDOROUTER_CREATE_TOKEN: "purple",
  SUDOROUTER_CREATE_TOKEN_FAILED: "red",
  SUDOROUTER_UPDATE_QUOTA: "purple",
  USER_CREATE: "green",
  USER_DELETE: "red",
  USER_UPDATE: "blue",
  INVITATION_CODE_CREATE: "cyan",
  INVITATION_CODE_DELETE: "red",
};

const OperationLogs: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [actionFilter, setActionFilter] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(7, "day"),
    dayjs(),
  ]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedLog, setSelectedLog] = useState<OperationLog | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params: any = {
        page,
        page_size: pageSize,
      };
      if (actionFilter) params.action = actionFilter;
      if (dateRange) {
        params.date_from = dateRange[0].startOf("day").unix();
        params.date_to = dateRange[1].endOf("day").unix();
      }

      const response = await adminApi.getOperationLogs(params);
      if ((response as any).success) {
        setLogs((response as any).data.items);
        setTotal((response as any).data.total);
      }
    } catch (error) {
      console.error("Failed to load logs:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [page, pageSize]);

  const showDetail = (record: OperationLog) => {
    setSelectedLog(record);
    setDetailVisible(true);
  };

  const parseJson = (jsonStr: string | null | undefined): any => {
    if (!jsonStr) return null;
    try {
      return JSON.parse(jsonStr);
    } catch {
      return jsonStr;
    }
  };

  const columns = [
    {
      title: "时间",
      dataIndex: "created_at",
      key: "created_at",
      width: 160,
      fixed: "left" as const,
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: "操作人",
      key: "user",
      width: 120,
      render: (_: any, record: OperationLog) => record.user_phone || `-`,
    },
    {
      title: "操作类型",
      dataIndex: "action",
      key: "action",
      width: 180,
      render: (val: string) => (
        <Tag color={actionColors[val] || "default"}>
          {actionLabels[val] || val}
        </Tag>
      ),
    },
    {
      title: "资源",
      key: "resource",
      width: 120,
      render: (_: any, record: OperationLog) => (
        <span>
          {record.resource}
          {record.resource_id ? ` #${record.resource_id}` : ""}
        </span>
      ),
    },
    {
      title: "请求方法",
      key: "method",
      width: 80,
      render: (_: any, record: OperationLog) => (
        <Tag color={record.method === "GET" ? "blue" : record.method === "POST" ? "green" : record.method === "DELETE" ? "red" : "orange"}>
          {record.method}
        </Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "response_status",
      key: "response_status",
      width: 80,
      render: (val: number) => (
        <Tag color={val && val < 400 ? "green" : "red"}>{val || "-"}</Tag>
      ),
    },
    {
      title: "耗时",
      dataIndex: "duration_ms",
      key: "duration_ms",
      width: 80,
      render: (val: number) => (val ? `${val}ms` : "-"),
    },
    {
      title: "操作",
      key: "action_btn",
      width: 80,
      fixed: "right" as const,
      render: (_: any, record: OperationLog) => (
        <Button type="link" size="small" onClick={() => showDetail(record)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>
          操作日志
        </Title>
      </div>

      <Card>
        <div style={{ marginBottom: 16 }}>
          <Space wrap>
            <span>操作类型：</span>
            <Select
              style={{ width: 180 }}
              value={actionFilter}
              onChange={(val) => {
                setActionFilter(val);
                setPage(1);
              }}
              allowClear
              placeholder="全部"
            >
              {Object.entries(actionLabels).map(([key, label]) => (
                <Select.Option key={key} value={key}>
                  {label}
                </Select.Option>
              ))}
            </Select>

            <span>时间范围：</span>
            <RangePicker
              value={dateRange}
              onChange={(dates) => {
                setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs]);
                setPage(1);
              }}
            />

            <Button type="primary" onClick={loadLogs}>
              查询
            </Button>

            <Button onClick={() => {
              setActionFilter(undefined);
              setDateRange([dayjs().subtract(7, "day"), dayjs()]);
              setPage(1);
            }}>
              重置
            </Button>
          </Space>
        </div>

        <Table
          columns={columns}
          dataSource={logs}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1000 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      <Modal
        title="操作详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={800}
      >
        {selectedLog && (
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="时间" span={2}>
              {new Date(selectedLog.created_at).toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="操作人">
              {selectedLog.user_phone || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="操作类型">
              <Tag color={actionColors[selectedLog.action] || "default"}>
                {actionLabels[selectedLog.action] || selectedLog.action}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="资源">
              {selectedLog.resource}
              {selectedLog.resource_id ? ` #${selectedLog.resource_id}` : ""}
            </Descriptions.Item>
            <Descriptions.Item label="请求方法">
              <Tag color={selectedLog.method === "GET" ? "blue" : selectedLog.method === "POST" ? "green" : "orange"}>
                {selectedLog.method}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="请求路径" span={2}>
              <code style={{ wordBreak: "break-all" }}>{selectedLog.path}</code>
            </Descriptions.Item>
            <Descriptions.Item label="响应状态">
              <Tag color={selectedLog.response_status && selectedLog.response_status < 400 ? "green" : "red"}>
                {selectedLog.response_status || "-"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="耗时">
              {selectedLog.duration_ms ? `${selectedLog.duration_ms}ms` : "-"}
            </Descriptions.Item>

            {selectedLog.request_data && (
              <Descriptions.Item label="请求数据" span={2}>
                <pre style={{
                  margin: 0,
                  padding: 8,
                  background: "#f5f5f5",
                  borderRadius: 4,
                  maxHeight: 200,
                  overflow: "auto",
                  fontSize: 12,
                  wordBreak: "break-all",
                  whiteSpace: "pre-wrap",
                }}>
                  {JSON.stringify(parseJson(selectedLog.request_data), null, 2)}
                </pre>
              </Descriptions.Item>
            )}

            {selectedLog.response_data && (
              <Descriptions.Item label="响应数据" span={2}>
                <pre style={{
                  margin: 0,
                  padding: 8,
                  background: "#f5f5f5",
                  borderRadius: 4,
                  maxHeight: 200,
                  overflow: "auto",
                  fontSize: 12,
                  wordBreak: "break-all",
                  whiteSpace: "pre-wrap",
                }}>
                  {JSON.stringify(parseJson(selectedLog.response_data), null, 2)}
                </pre>
              </Descriptions.Item>
            )}

            {selectedLog.error_message && (
              <Descriptions.Item label="错误信息" span={2}>
                <span style={{ color: "#ff4d4f" }}>{selectedLog.error_message}</span>
              </Descriptions.Item>
            )}

            <Descriptions.Item label="IP地址">
              {selectedLog.ip_address || "-"}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
};

export default OperationLogs;
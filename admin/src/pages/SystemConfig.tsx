import React, { useState, useEffect } from "react";
import { Card, Radio, Typography, Button, Alert, Modal, message, Spin } from "antd";
import { ExclamationCircleOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { adminApi } from "../api";
import SwitchConfigCard from "../components/SwitchConfigCard";
import type {
  SchemaField,
  SwitchConfigCardValue,
} from "../components/SwitchConfigCard";

const { Title, Text } = Typography;

interface LoginDesc {
  title: string;
  text: string;
}

// 返回确定类型的登录方式描述(避免 Record 索引 possibly undefined)
function getDesc(m: number): LoginDesc {
  if (m === 1) {
    return {
      title: "用户名密码",
      text: "用户通过用户名 + 密码登录本系统。管理员在用户管理中为用户设定用户名与初始密码。",
    };
  }
  return {
    title: "手机验证码",
    text: "用户通过手机号 + 短信验证码登录本系统。切换到此方式需先完成腾讯云短信通道配置。",
  };
}

// 模块级常量,避免父组件 re-render 时 schema 引用变化触发子组件 useEffect 重置已编辑字段。
const LOG_REPORT_SCHEMA: SchemaField[] = [
  { kind: "protocol", name: "protocol", label: "上报协议" },
  { kind: "text", name: "domain", label: "上报域名", placeholder: "例如 123.com" },
];
const VERSION_UPDATE_SCHEMA: SchemaField[] = [
  {
    kind: "text",
    name: "cos_domain",
    label: "COS 访问域名",
    placeholder: "例如 cos.example.com",
  },
];
const PRODUCT_IMPROVEMENT_SCHEMA: SchemaField[] = [];

const SystemConfig: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loginMethod, setLoginMethod] = useState<number>(0);
  const [smsConfigured, setSmsConfigured] = useState<boolean>(false);
  const [radioVal, setRadioVal] = useState<number>(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectMsg, setRejectMsg] = useState("");
  const [logReport, setLogReport] = useState<SwitchConfigCardValue>({
    enabled: 0,
    protocol: "",
    domain: "",
  });
  const [versionUpdate, setVersionUpdate] = useState<SwitchConfigCardValue>({
    enabled: 0,
    cos_domain: "",
  });
  const [productImprovement, setProductImprovement] =
    useState<SwitchConfigCardValue>({
      enabled: 0,
      protocol: "",
      domain: "",
    });

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = (await adminApi.getAdminSystemConfig()) as any;
        if (response.success) {
          setLoginMethod(response.data.login_method);
          setSmsConfigured(response.data.sms_configured);
          setRadioVal(response.data.login_method);
          if (response.data.log_report) {
            setLogReport({
              enabled: response.data.log_report.enabled ?? 0,
              protocol: response.data.log_report.protocol ?? "",
              domain: response.data.log_report.domain ?? "",
            });
          }
          if (response.data.version_update) {
            setVersionUpdate({
              enabled: response.data.version_update.enabled ?? 0,
              cos_domain: response.data.version_update.cos_domain ?? "",
            });
          }
          if (response.data.product_improvement) {
            setProductImprovement({
              enabled: response.data.product_improvement.enabled ?? 0,
              protocol: response.data.product_improvement.protocol ?? "",
              domain: response.data.product_improvement.domain ?? "",
            });
          }
        }
      } catch (error) {
        message.error("加载系统配置失败");
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  const saveLogReport = async (payload: SwitchConfigCardValue) => {
    const res = (await adminApi.updateSystemConfig({
      log_report: {
        enabled: payload.enabled,
        protocol: (payload.protocol as string) ?? "",
        domain: (payload.domain as string) ?? "",
      },
    })) as any;
    if (!res?.success) {
      throw new Error(res?.msg || "保存失败");
    }
    setLogReport(payload);
  };
  const saveVersionUpdate = async (payload: SwitchConfigCardValue) => {
    const res = (await adminApi.updateSystemConfig({
      version_update: {
        enabled: payload.enabled,
        cos_domain: (payload.cos_domain as string) ?? "",
      },
    })) as any;
    if (!res?.success) {
      throw new Error(res?.msg || "保存失败");
    }
    setVersionUpdate(payload);
  };
  const saveProductImprovement = async (payload: SwitchConfigCardValue) => {
    const res = (await adminApi.updateSystemConfig({
      product_improvement: {
        enabled: payload.enabled,
      },
    })) as any;
    if (!res?.success) {
      throw new Error(res?.msg || "保存失败");
    }
    setProductImprovement(payload);
  };

  const handleSave = () => {
    if (radioVal === loginMethod) {
      message.info("登录方式未变更");
      return;
    }
    // 切到手机验证码(0)前,若短信通道未配置则前端先提示(后端也会校验)
    setRejectMsg(radioVal === 0 && !smsConfigured ? "短信通道未配置,无法切换" : "");
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (rejectMsg) {
      message.error("短信通道未配置,无法切换到手机验证码");
      return;
    }
    setSaving(true);
    try {
      const response = (await adminApi.updateSystemConfig({
        login_method: radioVal,
      })) as any;
      if (response.success) {
        setLoginMethod(radioVal);
        setConfirmOpen(false);
        message.success("登录方式已切换为:" + getDesc(radioVal).title);
      } else {
        message.error(response.msg || "切换失败");
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "切换失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Spin />;
  }

  const currentDesc = getDesc(radioVal);
  const activeDesc = getDesc(loginMethod);

  return (
    <div>
      <Title level={2} style={{ margin: "0 0 16px 0" }}>
        系统配置
      </Title>
      <Card title="登录方式" style={{ maxWidth: 760 }}>
        <Text type="secondary">
          选择用户登录本系统时使用的认证方式。切换登录方式需二次确认;切换到手机验证码需短信通道已配置。
        </Text>
        <div style={{ marginTop: 22 }}>
          <Radio.Group
            value={radioVal}
            onChange={(e) => setRadioVal(e.target.value)}
          >
            <Radio value={0}>手机验证码</Radio>
            <Radio value={1}>用户名密码</Radio>
          </Radio.Group>
        </div>
        <Alert
          style={{ marginTop: 22 }}
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          message={"当前选择:" + currentDesc.title}
          description={currentDesc.text}
        />
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <Text type="secondary">系统当前生效登录方式:</Text>
          <span style={{ marginLeft: 8, color: "#165DFF" }}>
            {activeDesc.title}
          </span>
        </div>
        <div style={{ marginTop: 22, textAlign: "right" }}>
          <Button type="primary" onClick={handleSave}>
            保存设置
          </Button>
        </div>
      </Card>

      <SwitchConfigCard
        title="日志上报"
        description="开启后将向指定的上报地址(协议 + 域名)发送日志。开启时上报协议与域名必填。"
        value={logReport}
        schema={LOG_REPORT_SCHEMA}
        onSave={saveLogReport}
      />
      <SwitchConfigCard
        title="版本自动更新"
        description="开启后系统将从指定的 COS 访问域名拉取版本。开启时 COS 访问域名必填。"
        value={versionUpdate}
        schema={VERSION_UPDATE_SCHEMA}
        onSave={saveVersionUpdate}
      />
      <SwitchConfigCard
        title="参与产品改进计划"
        description="用于开启匿名使用统计上报，收集使用数据帮助改进产品。开启前需在服务器配置 QMS_DEFAULT_API_KEY；若启用遥测加密，还需配置 QMS_TELEMETRY 公私钥对。"
        value={productImprovement}
        schema={PRODUCT_IMPROVEMENT_SCHEMA}
        onSave={saveProductImprovement}
      />

      <Modal
        title={
          <span>
            <ExclamationCircleOutlined
              style={{ color: "#faad14", marginRight: 8 }}
            />
            确认切换登录方式
          </span>
        }
        open={confirmOpen}
        onCancel={() => {
          setConfirmOpen(false);
          setRejectMsg("");
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setConfirmOpen(false);
              setRejectMsg("");
            }}
          >
            取消
          </Button>,
          <Button
            key="ok"
            type="primary"
            danger={!!rejectMsg}
            disabled={!!rejectMsg}
            loading={saving}
            onClick={handleConfirm}
          >
            {rejectMsg ? "无法切换" : "确认切换"}
          </Button>,
        ]}
      >
        <p style={{ marginBottom: 12 }}>
          将登录方式从【<b>{activeDesc.title}</b>】切换为【
          <b>{currentDesc.title}</b>】?
        </p>
        <ul style={{ color: "#86909c", paddingLeft: 20, marginBottom: 0 }}>
          <li>切换后,用户管理列表将只显示对应方式的用户。</li>
          <li>另一种方式的用户将暂时不可见、不可登录(数据保留,切回后恢复)。</li>
        </ul>
        {rejectMsg && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 14 }}
            message={"✗ " + rejectMsg}
            description="请先在服务器环境配置腾讯云短信(SMS_PROVIDER=tencent 及 6 项凭证)后再切换。"
          />
        )}
      </Modal>
    </div>
  );
};

export default SystemConfig;

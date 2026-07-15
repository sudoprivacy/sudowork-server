import React, { useState, useEffect } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
} from "antd";
import {
  ExclamationCircleOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
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

interface ThirdPartyProviderConfig {
  id: string;
  name: string;
  type: "cas";
  enabled: number;
  cas_url: string;
  login_path: string;
  validate_path: string;
  logout_path: string;
  logout_service_url: string;
  service_param: string;
  service_encode_mode: "component" | "raw";
  callback_mode: "direct_app" | "server_callback";
  server_callback_url: string;
  app_callback_url: string;
  enterprise_code: string;
  auto_provision: number;
}

interface ThirdPartyAuthConfig {
  enabled: number;
  default_provider: string;
  providers: ThirdPartyProviderConfig[];
}

const DEFAULT_COMAC_SERVER_CALLBACK_URL =
  "http://127.0.0.1:3000/api/v1/auth/third-party/cas/callback/comac_cas";
const DEFAULT_COMAC_LOGOUT_SERVICE_URL =
  "http://127.0.0.1:3000/api/v1/auth/third-party/cas/logout/callback/comac_cas";

const DEFAULT_THIRD_PARTY_AUTH: ThirdPartyAuthConfig = {
  enabled: 1,
  default_provider: "comac_cas",
  providers: [
    {
      id: "comac_cas",
      name: "中国商飞",
      type: "cas",
      enabled: 1,
      cas_url: "http://cas.cvtol.com/",
      login_path: "/cas/login/",
      validate_path: "/cas/p3/serviceValidate",
      logout_path: "/cas/logout",
      logout_service_url: DEFAULT_COMAC_LOGOUT_SERVICE_URL,
      service_param: "service",
      service_encode_mode: "component",
      callback_mode: "server_callback",
      server_callback_url: DEFAULT_COMAC_SERVER_CALLBACK_URL,
      app_callback_url: "sudowork://cas-callback/comac_cas/callback",
      enterprise_code: "sudo",
      auto_provision: 1,
    },
  ],
};

// 返回确定类型的登录方式描述(避免 Record 索引 possibly undefined)
function getDesc(m: number): LoginDesc {
  if (m === 2) {
    return {
      title: "三方认证登录",
      text: "用户通过客户 CAS 系统完成认证，首次登录时按 Provider 绑定企业自动创建普通用户。",
    };
  }
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

function normalizeThirdPartyAuthConfig(value: any): ThirdPartyAuthConfig {
  if (!value?.providers?.length) {
    return DEFAULT_THIRD_PARTY_AUTH;
  }
  return {
    enabled: value.enabled === 0 ? 0 : 1,
    default_provider:
      value.default_provider || DEFAULT_THIRD_PARTY_AUTH.default_provider,
    providers: value.providers.map((provider: any) => {
      const fallback = DEFAULT_THIRD_PARTY_AUTH.providers[0]!;
      const providerId = provider.id || fallback.id;
      const serverCallbackUrl =
        provider.server_callback_url || fallback.server_callback_url;
      return {
        ...fallback,
        ...provider,
        enabled: provider.enabled === 0 ? 0 : 1,
        auto_provision: provider.auto_provision === 0 ? 0 : 1,
        service_encode_mode:
          provider.service_encode_mode === "raw" ? "raw" : "component",
        callback_mode:
          provider.callback_mode === "direct_app"
            ? "direct_app"
            : "server_callback",
        server_callback_url: serverCallbackUrl,
        logout_service_url:
          provider.logout_service_url ||
          buildLogoutServiceUrl(serverCallbackUrl, providerId),
        app_callback_url:
          provider.app_callback_url ||
          `sudowork://cas-callback/${providerId}/callback`,
        type: "cas",
      };
    }),
  };
}

function getInputValue(event: any): string {
  return event?.target?.value ?? "";
}

function buildLogoutServiceUrl(
  serverCallbackUrl: string,
  providerId: string,
): string {
  if (!serverCallbackUrl) {
    return "";
  }
  try {
    const url = new URL(serverCallbackUrl);
    url.pathname = url.pathname.replace(
      /\/callback\/[^/]+\/?$/,
      `/logout/callback/${encodeURIComponent(providerId)}`,
    );
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}

// 模块级常量,避免父组件 re-render 时 schema 引用变化触发子组件 useEffect 重置已编辑字段。
const LOG_REPORT_SCHEMA: SchemaField[] = [
  { kind: "protocol", name: "protocol", label: "上报协议" },
  {
    kind: "text",
    name: "domain",
    label: "上报域名",
    placeholder: "例如 123.com",
  },
  {
    kind: "secret",
    name: "key",
    label: "上报 Key",
    placeholder: "请填写上报凭证 Key",
  },
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
  const [thirdPartyAuth, setThirdPartyAuth] = useState<ThirdPartyAuthConfig>(
    DEFAULT_THIRD_PARTY_AUTH,
  );
  const [selectedProviderId, setSelectedProviderId] =
    useState<string>("comac_cas");
  const [savingThirdParty, setSavingThirdParty] = useState(false);
  const [logReport, setLogReport] = useState<SwitchConfigCardValue>({
    enabled: 0,
    protocol: "",
    domain: "",
  });
  const [logReportKeySet, setLogReportKeySet] = useState<boolean>(false);
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
          if (response.data.third_party_auth) {
            const nextThirdPartyAuth = normalizeThirdPartyAuthConfig(
              response.data.third_party_auth,
            );
            setThirdPartyAuth(nextThirdPartyAuth);
            setSelectedProviderId(nextThirdPartyAuth.default_provider);
          }
          if (response.data.log_report) {
            setLogReport({
              enabled: response.data.log_report.enabled ?? 0,
              protocol: response.data.log_report.protocol ?? "",
              domain: response.data.log_report.domain ?? "",
              key: "",
            });
            setLogReportKeySet(!!response.data.log_report.key_set);
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
        key: (payload.key as string) ?? "",
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
  const saveThirdPartyAuth = async () => {
    setSavingThirdParty(true);
    try {
      const res = (await adminApi.updateSystemConfig({
        third_party_auth: thirdPartyAuth,
      })) as any;
      if (!res?.success) {
        throw new Error(res?.msg || "保存失败");
      }
      message.success("三方认证配置已保存");
    } catch (error: any) {
      message.error(error.response?.data?.msg || error.message || "保存失败");
    } finally {
      setSavingThirdParty(false);
    }
  };

  const selectedProvider =
    thirdPartyAuth.providers.find((item) => item.id === selectedProviderId) ||
    thirdPartyAuth.providers[0];

  const updateThirdPartyAuth = (patch: Partial<ThirdPartyAuthConfig>) => {
    setThirdPartyAuth((prev) => ({ ...prev, ...patch }));
  };

  const updateSelectedProvider = (patch: Partial<ThirdPartyProviderConfig>) => {
    setThirdPartyAuth((prev) => ({
      ...prev,
      providers: prev.providers.map((provider) => {
        if (provider.id !== selectedProviderId) {
          return provider;
        }
        const previousDefaultLogoutServiceUrl = buildLogoutServiceUrl(
          provider.server_callback_url,
          provider.id,
        );
        const nextProvider = { ...provider, ...patch };
        if (
          patch.server_callback_url !== undefined &&
          (!provider.logout_service_url ||
            provider.logout_service_url === previousDefaultLogoutServiceUrl)
        ) {
          nextProvider.logout_service_url = buildLogoutServiceUrl(
            patch.server_callback_url,
            provider.id,
          );
        }
        return nextProvider;
      }),
    }));
  };

  const handleSave = () => {
    if (radioVal === loginMethod) {
      message.info("登录方式未变更");
      return;
    }
    // 切到手机验证码(0)前,若短信通道未配置则前端先提示(后端也会校验)
    setRejectMsg(
      radioVal === 0 && !smsConfigured ? "短信通道未配置,无法切换" : "",
    );
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
        ...(radioVal === 2 ? { third_party_auth: thirdPartyAuth } : {}),
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
            <Radio value={2}>三方认证登录</Radio>
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

      {(radioVal === 2 || loginMethod === 2) && selectedProvider && (
        <Card title="三方认证登录配置" style={{ maxWidth: 760, marginTop: 16 }}>
          <Text type="secondary">
            当前 Provider 使用客户 CAS 协议。默认通过服务端 HTTP 回调完成 CAS
            ticket 校验，再使用一次性短码唤起
            Sudowork。用户首次认证成功后会在绑定企业下自动创建普通用户，并补齐邀请码、初始积分和
            Sudorouter Token。
          </Text>
          <Form layout="vertical" style={{ marginTop: 20 }}>
            <Form.Item label="启用三方认证">
              <Switch
                checked={thirdPartyAuth.enabled === 1}
                onChange={(checked) =>
                  updateThirdPartyAuth({ enabled: checked ? 1 : 0 })
                }
              />
            </Form.Item>
            <Form.Item label="Provider">
              <Select
                value={selectedProviderId}
                onChange={(value) => {
                  setSelectedProviderId(value);
                  updateThirdPartyAuth({ default_provider: value });
                }}
              >
                {thirdPartyAuth.providers.map((provider) => (
                  <Select.Option key={provider.id} value={provider.id}>
                    {provider.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Space size={12} style={{ width: "100%" }} align="start">
              <Form.Item label="Provider ID" style={{ flex: 1 }}>
                <Input value={selectedProvider.id} disabled />
              </Form.Item>
              <Form.Item label="Provider 名称" style={{ flex: 1 }}>
                <Input
                  value={selectedProvider.name}
                  onChange={(e) =>
                    updateSelectedProvider({ name: getInputValue(e) })
                  }
                />
              </Form.Item>
            </Space>
            <Form.Item label="CAS URL">
              <Input
                value={selectedProvider.cas_url}
                placeholder="http://cas.cvtol.com/"
                onChange={(e) =>
                  updateSelectedProvider({ cas_url: getInputValue(e) })
                }
              />
            </Form.Item>
            <Form.Item label="回调模式">
              <Select
                value={selectedProvider.callback_mode}
                onChange={(value) =>
                  updateSelectedProvider({
                    callback_mode: value as "direct_app" | "server_callback",
                  })
                }
              >
                <Select.Option value="server_callback">
                  服务端 HTTP 回调
                </Select.Option>
                <Select.Option value="direct_app">App 直连回调</Select.Option>
              </Select>
            </Form.Item>
            {selectedProvider.callback_mode === "server_callback" && (
              <Form.Item label="服务端回调 URL">
                <Input
                  value={selectedProvider.server_callback_url}
                  placeholder="https://server.example.com/api/v1/auth/third-party/cas/callback/comac_cas"
                  onChange={(e) =>
                    updateSelectedProvider({
                      server_callback_url: getInputValue(e),
                    })
                  }
                />
              </Form.Item>
            )}
            <Form.Item label="App 回调 URL">
              <Input
                value={selectedProvider.app_callback_url}
                placeholder="sudowork://cas-callback/comac_cas/callback"
                onChange={(e) =>
                  updateSelectedProvider({
                    app_callback_url: getInputValue(e),
                  })
                }
              />
            </Form.Item>
            <Space size={12} style={{ width: "100%" }} align="start">
              <Form.Item label="登录 Path" style={{ flex: 1 }}>
                <Input
                  value={selectedProvider.login_path}
                  onChange={(e) =>
                    updateSelectedProvider({ login_path: getInputValue(e) })
                  }
                />
              </Form.Item>
              <Form.Item label="校验 Path" style={{ flex: 1 }}>
                <Input
                  value={selectedProvider.validate_path}
                  onChange={(e) =>
                    updateSelectedProvider({ validate_path: getInputValue(e) })
                  }
                />
              </Form.Item>
            </Space>
            <Space size={12} style={{ width: "100%" }} align="start">
              <Form.Item label="登出 Path" style={{ flex: 1 }}>
                <Input
                  value={selectedProvider.logout_path}
                  onChange={(e) =>
                    updateSelectedProvider({ logout_path: getInputValue(e) })
                  }
                />
              </Form.Item>
              <Form.Item label="Service 参数名" style={{ flex: 1 }}>
                <Input
                  value={selectedProvider.service_param}
                  onChange={(e) =>
                    updateSelectedProvider({ service_param: getInputValue(e) })
                  }
                />
              </Form.Item>
            </Space>
            <Form.Item label="登出回跳 URL">
              <Input
                value={selectedProvider.logout_service_url}
                placeholder={buildLogoutServiceUrl(
                  selectedProvider.server_callback_url,
                  selectedProvider.id,
                )}
                onChange={(e) =>
                  updateSelectedProvider({
                    logout_service_url: getInputValue(e),
                  })
                }
              />
            </Form.Item>
            <Form.Item label="Service 编码方式">
              <Select
                value={selectedProvider.service_encode_mode}
                onChange={(value) =>
                  updateSelectedProvider({
                    service_encode_mode: value as "component" | "raw",
                  })
                }
              >
                <Select.Option value="component">标准 URL 编码</Select.Option>
                <Select.Option value="raw">不编码</Select.Option>
              </Select>
            </Form.Item>
            <Space size={12} style={{ width: "100%" }} align="start">
              <Form.Item label="绑定企业码" style={{ flex: 1 }}>
                <Input
                  value={selectedProvider.enterprise_code}
                  placeholder="sudo"
                  onChange={(e) =>
                    updateSelectedProvider({
                      enterprise_code: getInputValue(e),
                    })
                  }
                />
              </Form.Item>
              <Form.Item label="自动创建用户" style={{ flex: 1 }}>
                <Switch
                  checked={selectedProvider.auto_provision === 1}
                  onChange={(checked) =>
                    updateSelectedProvider({
                      auto_provision: checked ? 1 : 0,
                    })
                  }
                />
              </Form.Item>
            </Space>
            <div style={{ textAlign: "right" }}>
              <Button
                type="primary"
                loading={savingThirdParty}
                onClick={saveThirdPartyAuth}
              >
                保存三方认证配置
              </Button>
            </div>
          </Form>
        </Card>
      )}

      <SwitchConfigCard
        title="日志上报"
        description="开启后将向指定的上报地址(协议 + 域名)发送日志。开启时上报协议与域名必填。"
        value={logReport}
        schema={LOG_REPORT_SCHEMA}
        onSave={saveLogReport}
        secretFieldsSet={{ key: logReportKeySet }}
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
          <li>其他方式的用户将暂时不可见、不可登录(数据保留,切回后恢复)。</li>
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

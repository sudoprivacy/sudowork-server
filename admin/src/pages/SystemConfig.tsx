import React, { useState, useEffect } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
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

type RechargeMode = "pay" | "approve" | "disabled";

interface CreditApplicationConfig {
  min_points: number;
  max_points: number;
  allow_duplicate_pending: boolean;
}

interface ApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  msg?: string;
}

interface AdminSystemConfigData {
  login_method: number;
  sms_configured: boolean;
  third_party_auth?: unknown;
  log_report?: {
    enabled?: number;
    protocol?: string;
    domain?: string;
    key_set?: boolean;
  };
  version_update?: {
    enabled?: number;
    cos_domain?: string;
  };
  product_improvement?: {
    enabled?: number;
    protocol?: string;
    domain?: string;
  };
  scode_auto_model?: string;
  recharge_mode?: unknown;
  credit_application?: unknown;
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

const DEFAULT_CREDIT_APPLICATION_CONFIG: CreditApplicationConfig = {
  min_points: 100,
  max_points: 1000000,
  allow_duplicate_pending: false,
};

function normalizeRechargeMode(value: unknown): RechargeMode {
  return value === "approve" || value === "disabled" || value === "pay"
    ? value
    : "pay";
}

function normalizeCreditApplicationConfig(
  value: unknown,
): CreditApplicationConfig {
  if (!value || typeof value !== "object") {
    return DEFAULT_CREDIT_APPLICATION_CONFIG;
  }
  const data = value as Partial<CreditApplicationConfig>;
  const minPoints = Number(data.min_points);
  const maxPoints = Number(data.max_points);
  return {
    min_points:
      Number.isInteger(minPoints) && minPoints > 0
        ? minPoints
        : DEFAULT_CREDIT_APPLICATION_CONFIG.min_points,
    max_points:
      Number.isInteger(maxPoints) && maxPoints > 0
        ? maxPoints
        : DEFAULT_CREDIT_APPLICATION_CONFIG.max_points,
    allow_duplicate_pending: data.allow_duplicate_pending === true,
  };
}

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

function normalizeThirdPartyAuthConfig(value: unknown): ThirdPartyAuthConfig {
  if (!value || typeof value !== "object") {
    return DEFAULT_THIRD_PARTY_AUTH;
  }

  const data = value as Partial<ThirdPartyAuthConfig> & {
    providers?: unknown[];
  };
  if (!Array.isArray(data.providers) || data.providers.length === 0) {
    return DEFAULT_THIRD_PARTY_AUTH;
  }
  return {
    enabled: data.enabled === 0 ? 0 : 1,
    default_provider:
      data.default_provider || DEFAULT_THIRD_PARTY_AUTH.default_provider,
    providers: data.providers.map((providerValue) => {
      const fallback = DEFAULT_THIRD_PARTY_AUTH.providers[0]!;
      const provider =
        providerValue && typeof providerValue === "object"
          ? (providerValue as Partial<ThirdPartyProviderConfig>)
          : {};
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

function getInputValue(
  event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
): string {
  return event.target.value;
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

function getRequestErrorMessage(error: unknown, fallback: string): string {
  const responseMessage =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: { data?: { msg?: unknown } } }).response?.data
          ?.msg
      : undefined;
  if (typeof responseMessage === "string" && responseMessage) {
    return responseMessage;
  }
  return error instanceof Error && error.message ? error.message : fallback;
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
  const [savingScodeAutoModel, setSavingScodeAutoModel] = useState(false);
  const [scodeAutoModel, setScodeAutoModel] = useState<string>("");
  const [savingRechargeConfig, setSavingRechargeConfig] = useState(false);
  const [rechargeMode, setRechargeMode] = useState<RechargeMode>("pay");
  const [creditApplication, setCreditApplication] =
    useState<CreditApplicationConfig>(DEFAULT_CREDIT_APPLICATION_CONFIG);
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
        const response =
          (await adminApi.getAdminSystemConfig()) as ApiResponse<AdminSystemConfigData>;
        if (response.success && response.data) {
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
          if (typeof response.data.scode_auto_model === "string") {
            setScodeAutoModel(response.data.scode_auto_model);
          }
          setRechargeMode(normalizeRechargeMode(response.data.recharge_mode));
          setCreditApplication(
            normalizeCreditApplicationConfig(response.data.credit_application),
          );
        }
      } catch {
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
    })) as ApiResponse;
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
    })) as ApiResponse;
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
    })) as ApiResponse;
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
      })) as ApiResponse;
      if (!res?.success) {
        throw new Error(res?.msg || "保存失败");
      }
      message.success("三方认证配置已保存");
    } catch (error: unknown) {
      message.error(getRequestErrorMessage(error, "保存失败"));
    } finally {
      setSavingThirdParty(false);
    }
  };
  const saveScodeAutoModel = async () => {
    const nextModel = scodeAutoModel.trim();

    setSavingScodeAutoModel(true);
    try {
      const res = (await adminApi.updateSystemConfig({
        scode_auto_model: nextModel,
      })) as ApiResponse;
      if (!res?.success) {
        throw new Error(res?.msg || "保存失败");
      }
      setScodeAutoModel(nextModel);
      message.success("Sudowork Auto 默认模型已保存");
    } catch (error: unknown) {
      message.error(getRequestErrorMessage(error, "保存失败"));
    } finally {
      setSavingScodeAutoModel(false);
    }
  };
  const saveRechargeConfig = async () => {
    const nextConfig = normalizeCreditApplicationConfig(creditApplication);
    if (nextConfig.max_points < nextConfig.min_points) {
      message.error("最大申请积分不能小于最小申请积分");
      return;
    }

    setSavingRechargeConfig(true);
    try {
      const res = (await adminApi.updateSystemConfig({
        recharge_mode: rechargeMode,
        credit_application: nextConfig,
      })) as ApiResponse;
      if (!res?.success) {
        throw new Error(res?.msg || "保存失败");
      }
      setCreditApplication(nextConfig);
      message.success("充值模式配置已保存");
    } catch (error: unknown) {
      message.error(getRequestErrorMessage(error, "保存失败"));
    } finally {
      setSavingRechargeConfig(false);
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
      })) as ApiResponse;
      if (response.success) {
        setLoginMethod(radioVal);
        setConfirmOpen(false);
        message.success("登录方式已切换为:" + getDesc(radioVal).title);
      } else {
        message.error(response.msg || "切换失败");
      }
    } catch (error: unknown) {
      message.error(getRequestErrorMessage(error, "切换失败"));
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

      <Card
        title="Sudowork Auto 默认模型"
        style={{ maxWidth: 760, marginTop: 16 }}
      >
        <Text type="secondary">
          可选配置。留空时，Sudowork 客户端继续沿用原有 auto
          选择逻辑；填写后，客户端重新登录或刷新模型列表会同步该配置，同步后的新会话生效。
        </Text>
        <Form layout="vertical" style={{ marginTop: 20 }}>
          <Form.Item label="Auto 默认模型（可选）">
            <Input
              value={scodeAutoModel}
              placeholder="留空则沿用客户端原有 auto 选择逻辑"
              onChange={(e) => setScodeAutoModel(getInputValue(e))}
            />
          </Form.Item>
          <div style={{ textAlign: "right" }}>
            <Button
              type="primary"
              loading={savingScodeAutoModel}
              onClick={saveScodeAutoModel}
            >
              保存 Auto 模型
            </Button>
          </div>
        </Form>
      </Card>

      <Card title="充值模式" style={{ maxWidth: 760, marginTop: 16 }}>
        <Text type="secondary">
          控制客户端设置页中的充值入口。选择“积分申请审批”后，客户端显示积分申请表单，管理员在后台“积分申请”菜单审批并发放到
          Sudorouter；未配置时默认保持支付充值模式。
        </Text>
        <Form layout="vertical" style={{ marginTop: 20 }}>
          <Form.Item label="模式">
            <Radio.Group
              value={rechargeMode}
              onChange={(event) =>
                setRechargeMode(normalizeRechargeMode(event.target.value))
              }
            >
              <Radio value="pay">支付充值</Radio>
              <Radio value="approve">积分申请审批</Radio>
              <Radio value="disabled">关闭入口</Radio>
            </Radio.Group>
          </Form.Item>
          <Space size={12} style={{ width: "100%" }} align="start">
            <Form.Item label="最小申请积分" style={{ flex: 1 }}>
              <InputNumber
                min={1}
                precision={0}
                style={{ width: "100%" }}
                value={creditApplication.min_points}
                onChange={(value) =>
                  setCreditApplication((prev) => ({
                    ...prev,
                    min_points: Number(value) || prev.min_points,
                  }))
                }
              />
            </Form.Item>
            <Form.Item label="最大申请积分" style={{ flex: 1 }}>
              <InputNumber
                min={1}
                precision={0}
                style={{ width: "100%" }}
                value={creditApplication.max_points}
                onChange={(value) =>
                  setCreditApplication((prev) => ({
                    ...prev,
                    max_points: Number(value) || prev.max_points,
                  }))
                }
              />
            </Form.Item>
          </Space>
          <Form.Item label="允许重复待审批申请">
            <Switch
              checked={creditApplication.allow_duplicate_pending}
              onChange={(checked) =>
                setCreditApplication((prev) => ({
                  ...prev,
                  allow_duplicate_pending: checked,
                }))
              }
            />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message={
              rechargeMode === "approve"
                ? "当前选择:积分申请审批"
                : rechargeMode === "disabled"
                  ? "当前选择:关闭充值入口"
                  : "当前选择:支付充值"
            }
            description={
              rechargeMode === "approve"
                ? "用户提交积分申请后，由超级管理员或本企业管理员审批；审批通过后自动写入 Sudorouter，并在充值记录中关联申请单。"
                : rechargeMode === "disabled"
                  ? "客户端不显示充值入口，也不会展示积分申请入口。"
                  : "客户端继续显示原充值中心，富友支付链路保持不变。"
            }
          />
          <div style={{ marginTop: 22, textAlign: "right" }}>
            <Button
              type="primary"
              loading={savingRechargeConfig}
              onClick={saveRechargeConfig}
            >
              保存充值模式
            </Button>
          </div>
        </Form>
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

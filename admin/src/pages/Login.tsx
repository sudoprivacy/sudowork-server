import React, { useState } from "react";
import { Form, Input, Button, message } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { adminApi } from "../api/index";
import { useNavigate } from "react-router-dom";
import "./Login.css";

interface LoginFormValues {
  phone: string;
  password: string;
}

const LoginForm: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      const data = await adminApi.login(values);
      if ((data as any).success) {
        localStorage.setItem("admin_token", (data as any).data.token);
        localStorage.setItem("admin_user", JSON.stringify((data as any).data.user));
        message.success("登录成功");
        navigate("/");
      } else {
        message.error((data as any).msg || "登录失败");
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-background">
        <div className="login-bg-circle login-bg-circle--lg" />
        <div className="login-bg-circle login-bg-circle--md" />
        <div className="login-bg-circle login-bg-circle--sm" />
      </div>

      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <svg className="login-logo-svg" viewBox="0 0 80 80" fill="none">
              <path
                d="M78.7034,21.9581 C78.5522,21.6152 78.4472,21.3188 78.3117,21.1156 L58.7503,10.7582 L58.7382,10.747 L58.7261,10.747 L38.873,0.3896 C38.3184,0.0809 37.6506,0 37.1135,0.2905 L0.8647,21.1119 C0.3391,21.4024 0.0234,22.0059 0.0234,22.6552 L0.0234,43.2112 C0.0234,43.2112 0.0234,43.2227 0.0234,43.2341 C0.0234,43.2456 0.0234,43.2456 0.0234,43.2456 L0.0234,63.8016 C0.0234,63.8016 0.0234,63.8131 0.0234,63.8131 C0.0234,63.9814 0.3391,64.5849 0.8647,64.8754 L37.1135,85.6968 C37.6499,85.9873 38.3184,85.9873 38.8548,85.6968 C38.8886,85.6763 38.9342,85.6558 38.968,85.6433 L58.6985,75.3513 L58.7094,75.3401 L58.7202,75.3289 L78.5733,65.0798 L78.5842,65.0686 C79.11,64.7781 79.4257,64.1746 79.4257,63.8131 L79.4257,22.6664 C79.4257,22.4383 79.3801,22.2214 78.7034,21.9581 Z M60.144,52.9255 L60.144,33.8351 L75.1888,25.435 L75.1888,60.9985 L60.144,52.9255 Z M56.6792,15.1383 L56.6792,32.5851 L38.9092,41.3644 L24.1504,32.5851 L56.6792,15.1383 Z M16.8562,32.5851 L3.8832,40.4709 L3.8832,25.435 L16.8562,32.5851 Z M20.2354,34.8183 L37.0192,44.4757 L37.0192,60.9985 L20.2354,43.5517 L20.2354,34.8183 Z M37.0306,64.8883 L37.0306,80.5657 L3.9948,63.8131 L20.2466,54.8857 L37.0306,64.8883 Z M40.4098,44.4757 L54.801,36.6857 L54.801,71.8957 L40.4098,63.6933 L40.4098,44.4757 Z M58.7261,29.8976 L58.7261,15.1383 L71.6879,22.6552 L58.7261,29.8976 Z M40.4098,19.6164 L40.4098,4.7239 L53.3541,12.2407 L40.4098,19.6164 Z M37.0306,21.6239 L21.0034,30.8407 L7.5234,22.6476 L37.0306,4.7351 L37.0306,21.6239 Z M3.8944,46.3992 L16.8562,53.8807 L3.8944,61.3622 L3.8944,46.3992 Z M40.4098,67.2492 L53.3653,74.7307 L40.4098,82.2122 L40.4098,67.2492 Z M58.7149,56.8792 L71.6879,64.8883 L58.7149,72.8974 L58.7149,56.8792 Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <h1 className="login-title">SUDOWORK</h1>
          <p className="login-subtitle">管理后台</p>
        </div>

        <Form name="login" onFinish={onFinish} autoComplete="off" size="large">
          <Form.Item
            name="phone"
            rules={[{ required: true, message: "请输入账号" }]}
          >
            <Input prefix={<UserOutlined />} placeholder="请输入账号" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
};

export default LoginForm;
import React, { useState, useEffect } from "react";
import { Spin } from "antd";
import { adminApi } from "../api";
import UserList from "./UserList";
import UserListPassword from "./UserListPassword";

/**
 * 用户管理路由分流 wrapper。
 * 挂载时调 GET /system-config,按 login_method 渲染验证码(UserList)或密码(UserListPassword)组件。
 */
const UserManagement: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [loginMethod, setLoginMethod] = useState<number | null>(null);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = (await adminApi.getSystemConfig()) as any;
        if (response.success) {
          setLoginMethod(response.data.login_method);
        } else {
          setLoginMethod(0);
        }
      } catch {
        setLoginMethod(0);
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  if (loading) {
    return <Spin />;
  }
  if (loginMethod === 1) {
    return <UserListPassword />;
  }
  return <UserList />;
};

export default UserManagement;

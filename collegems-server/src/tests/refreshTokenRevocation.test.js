import test from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

import User from "../models/User.model.js";
import { login, refresh, logout, resetPassword } from "../controllers/auth.controller.js";
import { hashPassword } from "../utils/hashPassword.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test_jwt_refresh_secret";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.post("/api/auth/login", login);
app.post("/api/auth/refresh", refresh);
app.post("/api/auth/logout", logout);
app.post("/api/auth/reset-password", resetPassword);

let mongoServer;

test("Refresh token revocation on logout and password reset", async (t) => {
  await t.test("Setup", async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  await t.test("captured refresh token stops working after logout", async () => {
    await User.create({
      name: "Test Student",
      email: "student@test.com",
      password: await hashPassword("Password123!", 8),
      role: "student",
      studentId: "S1",
      semester: "1",
      course: "CS",
      isEmailVerified: true,
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "student@test.com", password: "Password123!" });

    assert.strictEqual(loginRes.status, 200);
    const cookies = loginRes.headers["set-cookie"];
    assert.ok(cookies?.some((c) => c.startsWith("refreshToken=")));

    const preLogoutRefresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookies);
    assert.strictEqual(preLogoutRefresh.status, 200);
    assert.ok(preLogoutRefresh.body.accessToken);

    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookies);
    assert.strictEqual(logoutRes.status, 200);

    // The captured (pre-logout) refresh token must now be rejected.
    const postLogoutRefresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookies);
    assert.strictEqual(postLogoutRefresh.status, 403);
  });

  await t.test("captured refresh token stops working after password reset", async () => {
    const user = await User.create({
      name: "Test Teacher",
      email: "teacher@test.com",
      password: await hashPassword("Password123!", 8),
      role: "teacher",
      teacherId: "T1",
      department: "CS",
      isEmailVerified: true,
      resetPasswordToken: "reset-token-abc",
      resetPasswordExpires: Date.now() + 60 * 60 * 1000,
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "teacher@test.com", password: "Password123!" });

    assert.strictEqual(loginRes.status, 200);
    const cookies = loginRes.headers["set-cookie"];

    const resetRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "reset-token-abc", password: "NewPassword456!" });
    assert.strictEqual(resetRes.status, 200);

    // The refresh token issued before the password reset must be rejected now.
    const postResetRefresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookies);
    assert.strictEqual(postResetRefresh.status, 403);

    const refreshed = await User.findById(user._id);
    assert.strictEqual(refreshed.refreshTokenVersion, 1);
  });

  await t.test("Teardown", async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });
});

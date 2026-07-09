import test from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import app from "../app.js";
import User from "../models/User.model.js";
import Attendance from "../models/Attendance.model.js";
import Course from "../models/Course.model.js";
import Semester from "../models/Semester.model.js";
import jwt from "jsonwebtoken";

function createToken(user) {
  const secret = process.env.JWT_SECRET || "testsecret";
  return jwt.sign({ id: user._id, role: user.role }, secret);
}

test("Batch attendance marking checks every student's semester freeze status", async (t) => {
  let mongoServer;
  let teacher, teacherToken;
  let frozenStudent, openStudent;

  t.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    process.env.JWT_SECRET = "testsecret";

    teacher = await User.create({
      name: "Batch Teacher",
      email: "batch.teacher@test.com",
      password: "pw",
      role: "teacher",
      department: "TestDept",
    });

    const course = await Course.create({
      name: "Batch Course",
      code: "BC101",
      department: "TestDept",
      semester: 1,
      teacher: teacher._id,
    });

    await Semester.create({ semester: "1", isFrozen: false });
    await Semester.create({ semester: "2", isFrozen: true });

    openStudent = await User.create({
      name: "Open Semester Student",
      email: "open.student@test.com",
      password: "pw",
      role: "student",
      studentId: "S-OPEN",
      semester: "1",
      course: String(course._id),
    });

    frozenStudent = await User.create({
      name: "Frozen Semester Student",
      email: "frozen.student@test.com",
      password: "pw",
      role: "student",
      studentId: "S-FROZEN",
      semester: "2",
      course: String(course._id),
    });

    teacherToken = createToken(teacher);
  });

  t.after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  await t.test("rejects the whole batch when a non-first student's semester is frozen", async () => {
    const res = await request(app)
      .post("/api/attendance/mark")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({
        date: "2026-10-05",
        records: [
          { studentId: String(openStudent._id), status: "present" },
          { studentId: String(frozenStudent._id), status: "present" },
        ],
      });

    assert.strictEqual(res.status, 403);

    const savedRecords = await Attendance.find({ date: "2026-10-05" });
    assert.strictEqual(savedRecords.length, 0, "No records should be written when any student's semester is frozen");
  });

  await t.test("allows the batch when every student's semester is open", async () => {
    const res = await request(app)
      .post("/api/attendance/mark")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({
        date: "2026-10-06",
        records: [{ studentId: String(openStudent._id), status: "present" }],
      });

    assert.strictEqual(res.status, 200);

    const savedRecords = await Attendance.find({ date: "2026-10-06" });
    assert.strictEqual(savedRecords.length, 1);
  });
});

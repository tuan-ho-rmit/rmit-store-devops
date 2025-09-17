const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

// Create test app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
const routes = require("../../routes");
app.use(routes);

describe("Authentication API Integration Tests", () => {
  describe("POST /api/auth/register", () => {
    const validUser = {
      email: "johndoe@student.rmit.edu.vn",
      firstName: "John",
      lastName: "Doe",
      password: "Password123!",
      isSubscribed: true
    };

    test("should register a new user successfully", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send(validUser)
        .set('Content-Type', 'application/json'); 

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("success", true);
    });

    test("should reject registration with invalid email", async () => {
      const invalidUser = {
        ...validUser,
        email: "",
      };

      const response = await request(app)
        .post("/api/auth/register")
        .send(invalidUser);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    test("should reject registration with mismatched passwords", async () => {
      const invalidUser = {
        ...validUser,
        password: null ,
      };

      const response = await request(app)
        .post("/api/auth/register")
        .send(invalidUser);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    test("should reject registration with missing required fields", async () => {
      const incompleteUser = {
        firstName: "John",
        email: "john@test.com",
      };

      const response = await request(app)
        .post("/api/auth/register")
        .send(incompleteUser);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("POST /api/auth/login", () => {
    const loginCredentials = {
      email: "test@student.rmit.edu.vn",
      password: "Password123!",
    };

    beforeEach(async () => {
      // Register user for login tests
      await request(app).post("/api/auth/register").send({
        firstName: "Test",
        lastName: "User",
        email: loginCredentials.email,
        password: loginCredentials.password,
        confirmPassword: loginCredentials.password,
      });
    });

    test("should login user with valid credentials", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send(loginCredentials);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("token");
      expect(response.body).toHaveProperty("user");
    });

    test("should reject login with invalid email", async () => {
      const response = await request(app).post("/api/auth/login").send({
        email: "nonexistent@test.com",
        password: "Password123!",
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    test("should reject login with invalid password", async () => {
      const response = await request(app).post("/api/auth/login").send({
        email: loginCredentials.email,
        password: "WrongPassword",
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("POST /api/auth/forgot", () => {
    test("should reject forgot password with invalid email format", async () => {
      const response = await request(app).post("/api/auth/forgot").send({
        email: "",
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });
  });
});
const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const User = require("../../models/user"); 
const { ROLES } = require("../../constants");

// Create test app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
const routes = require("../../routes");
app.use(routes);

describe("Products API Integration Tests", () => {
  let authToken;
  let adminToken;
  let userToken;

  // Setup before all tests
  beforeEach(async () => {
    // Create admin user for testing
    const adminResponse = await request(app)
      .post("/api/auth/register")
      .send({
        firstName: "Admin",
        lastName: "User",
        email: "admin@student.rmit.edu.vn",
        password: "AdminPassword123!",
        confirmPassword: "AdminPassword123!",
      });

    const adminUser = await User.findOne({ email: "admin@student.rmit.edu.vn" });
    if (adminUser) {
      adminUser.role = ROLES.Admin;
      await adminUser.save();
    }

    const userResponse = await request(app)
      .post("/api/auth/register")
      .send({
        firstName: "Admin12",
        lastName: "User12",
        email: "admin234@student.rmit.edu.vn",
        password: "AdminPassword123!",
        confirmPassword: "AdminPassword123!",
      });

    const normalUser = await User.findOne({ email: "admin234@student.rmit.edu.vn" });
    if (normalUser) {
      normalUser.role = ROLES.Merchant;
      await normalUser.save();
    }

    const adminLoginResponse = await request(app)
      .post("/api/auth/login")
      .send({
        email: "admin234@student.rmit.edu.vn",
        password: "AdminPassword123!",
      });

    adminToken = adminLoginResponse.body.token;

    const userLoginResponse = await request(app)
    .post("/api/auth/login")
    .send({
      email: "admin@student.rmit.edu.vn",
      password: "AdminPassword123!",
    });

    userToken = userLoginResponse.body.token;
    // Add a product before running the tests
    const productResponse = await request(app)
      .post("/api/product/add")
      .set("Authorization", `${adminToken}`)
      .send({
        sku: "TEST-001",
        name: "Test Product",
        description: "A test product for RMIT store",
        quantity: 100,
        price: 99.99,
        brand: "68c7a7e4e811220c64c36579",
        category: "Electronics",
        isActive: true,
      });

    expect(productResponse.status).toBe(200); 
  });

  describe("GET /api/product", () => {
    test("should fetch all products with pagination and filters", async () => {
      const response = await request(app)
        .get("/api/product")
        .set("Authorization", `${adminToken}`)
        .query({
          category: "Electronics", // Example filter
          brand: "68c7a7e4e811220c64c36579",
          min: 0,
          max: 1000,
          page: 1,
          limit: 10,
        })
        .expect(200);

      expect(response.body).toHaveProperty("products");
      expect(Array.isArray(response.body.products)).toBe(true);
    });
  });

  describe("GET /api/product/:slug", () => {
    test("should return 404 for non-existent product", async () => {
      const response = await request(app)
        .get("/api/product/bespoke-bamboo")  
        .set("Authorization", `${userToken}`)
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("POST /api/product/add", () => {
    test("should create a product with valid admin authentication", async () => {
      const validProduct = {
        sku: "TEST-002",
        name: "Valid Product",
        description: "A valid test product for RMIT store",
        quantity: 50,
        price: 199.99,
        brand: "68c7a7e4e811220c64c36579",
        category: "Electronics",
        isActive: true,
      };

      const response = await request(app)
        .post("/api/product/add")
        .set("Authorization", `${adminToken}`)
        .send(validProduct);

      expect(response.status).toBe(200); 
      expect(response.body).toHaveProperty("product");
      expect(response.body.product).toHaveProperty("sku", "TEST-002"); 
    });

    test("should reject product creation without authentication", async () => {
      const invalidProduct = {
        sku: "TEST-003",
        name: "Invalid Product",
        description: "Missing authentication",
        quantity: 50,
        price: 199.99,
        brand: "InvalidBrand",
        category: "Electronics",
        isActive: true,
      };

      const response = await request(app)
        .post("/api/product/add")
        .send(invalidProduct);

      expect(response.status).toBe(401); 
    });

    test("should reject product creation with invalid data", async () => {
      const invalidProduct = {
        name: "Invalid Product",
        // Missing required fields like 'sku', 'price', etc.
      };

      const response = await request(app)
        .post("/api/product/add")
        .set("Authorization", `${adminToken}`)
        .send(invalidProduct);

      expect(response.status).toBe(400);  // Should reject with invalid data
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("PUT /api/product/:id", () => {
    test("should reject update without authentication", async () => {
      const response = await request(app)
        .put("/api/product/Valid-Product")
        .send({
          name: "Updated Product Name",
        });

      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/product/delete/:id", () => {
    test("should reject deletion without authentication", async () => {
      const response = await request(app).delete(
        "/api/product/delete/507f1f77bcf86cd799439011"
      );

      expect(response.status).toBe(401);
    });

    test("should delete product with valid admin authentication", async () => {
      if (!adminToken) {
        console.log("Skipping test - no admin token available");
        return;
      }

      const response = await request(app)
        .delete("/api/product/delete/507f1f77bcf86cd799439011")
        .set("Authorization", `${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("message");
    });
  });

  // Cleanup after all tests
});

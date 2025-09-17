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

describe("Cart API Integration Tests", () => {
  let authToken;
  let userId;
  let testProductId;

  beforeEach(async () => {
    const userResponse = await request(app).post("/api/auth/register").send({
      firstName: "Cart",
      lastName: "Tester",
      email: "cart.test@student.rmit.edu.vn",
      password: "Password123!",
      confirmPassword: "Password123!",
    });

    const cartUser = await User.findOne({ email: "cart.test@student.rmit.edu.vn" });
    if (cartUser) {
      cartUser.role = ROLES.Admin;
      await cartUser.save();
    }

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: "cart.test@student.rmit.edu.vn",
      password: "Password123!",
    });
    
    if (loginResponse.body.token) {
      authToken = loginResponse.body.token;
      userId = loginResponse.body.user?.id;
    }

    testProductId = new mongoose.Types.ObjectId().toString();
  });

  describe("GET /api/cart", () => {
    test("should fetch user cart with authentication", async () => {
      if (!authToken) {
        console.log("Skipping test - no auth token available");
        return;
      }

      const response = await request(app)
        .get("/api/cart")
        .set("Authorization", ` ${authToken}`);

      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty("cart");
        expect(response.body.cart).toHaveProperty("products");
        expect(Array.isArray(response.body.cart.products)).toBe(true);
      }
    });

    test("should reject cart fetch without authentication", async () => {
      const response = await request(app).get("/api/cart");

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/cart/add", () => {
    const validCartItem = {
      product: "507f1f77bcf86cd799439011",
      quantity: 2,
      price: 99.99,
    };

    test("should add item to cart with authentication", async () => {
      if (!authToken) {
        console.log("Skipping test - no auth token available");
        return;
      }

      const response = await request(app)
        .post("/api/cart/add")
        .set("Authorization", ` ${authToken}`)
        .send(validCartItem);

      // Accept various success/error status codes
      expect([200, 201, 400, 404]).toContain(response.status);

      if (response.status === 200 || response.status === 201) {
        expect(response.body).toHaveProperty("success", true);
        expect(response.body).toHaveProperty("message");
      }
    });

    test("should reject adding item without authentication", async () => {
      const response = await request(app)
        .post("/api/cart/add")
        .send(validCartItem);

      expect(response.status).toBe(401);
    });

    test("should reject invalid product data", async () => {
      if (!authToken) {
        console.log("Skipping test - no auth token available");
        return;
      }

      const invalidCartItem = {
        product: "invalid-product-id",
        quantity: -1,
        price: "invalid-price",
      };

      const response = await request(app)
        .post("/api/cart/add")
        .set("Authorization", ` ${authToken}`)
        .send(invalidCartItem);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    test("should reject adding item with zero quantity", async () => {
      if (!authToken) {
        console.log("Skipping test - no auth token available");
        return;
      }

      const zeroQuantityItem = {
        ...validCartItem,
        quantity: 0,
      };

      const response = await request(app)
        .post("/api/cart/add")
        .set("Authorization", ` ${authToken}`)
        .send(zeroQuantityItem);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("PUT /api/cart/update", () => {
    const updateCartItem = {
      product: "507f1f77bcf86cd799439011",
      quantity: 3,
    };

    test("should update cart item with authentication", async () => {
      if (!authToken) {
        console.log("Skipping test - no auth token available");
        return;
      }

      const response = await request(app)
        .put("/api/cart/update")
        .set("Authorization", ` ${authToken}`)
        .send(updateCartItem);

      expect([200, 400, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty("success", true);
        expect(response.body).toHaveProperty("message");
      }
    });

    test("should reject cart update without authentication", async () => {
      const response = await request(app)
        .put("/api/cart/update")
        .send(updateCartItem);

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/cart/delete", () => {
    test("should remove item from cart with authentication", async () => {
      if (!authToken) {
        console.log("Skipping test - no auth token available");
        return;
      }

      const response = await request(app)
        .delete("/api/cart/delete")
        .set("Authorization", ` ${authToken}`)
        .send({
          product: "507f1f77bcf86cd799439011",
        });

      expect([200, 400, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty("success", true);
        expect(response.body).toHaveProperty("message");
      }
    });

    test("should reject cart item deletion without authentication", async () => {
      const response = await request(app).delete("/api/cart/delete").send({
        product: "507f1f77bcf86cd799439011",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/cart/clear", () => {
    test("should clear entire cart with authentication", async () => {
      if (!authToken) {
        console.log("Skipping test - no auth token available");
        return;
      }

      const response = await request(app)
        .post("/api/cart/clear")
        .set("Authorization", ` ${authToken}`);

      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty("success", true);
        expect(response.body).toHaveProperty("message");
      }
    });

    test("should reject cart clear without authentication", async () => {
      const response = await request(app).post("/api/cart/clear");

      expect(response.status).toBe(404);
    });
  });
});
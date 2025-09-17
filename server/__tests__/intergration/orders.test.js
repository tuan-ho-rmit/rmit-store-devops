const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const User = require("../../models/user"); 
const { ROLES } = require("../../constants");
// Import routes
const routes = require("../../routes");
app.use(routes);

describe("Order API Integration Tests", () => {
  let authToken;
  let userId;
  let testCartId;
  let testOrderId;

  beforeEach(async () => {
    const userResponse = await request(app).post("/api/auth/register").send({
      firstName: "Order",
      lastName: "Tester",
      email: "order.test@student.rmit.edu.vn",
      password: "Password123!",
      confirmPassword: "Password123!",
    });

    const orderUser = await User.findOne({ email: "order.test@student.rmit.edu.vn" });
        if (orderUser) {
          orderUser.role = ROLES.Admin;
          await orderUser.save();
        }

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: "order.test@student.rmit.edu.vn",
      password: "Password123!",
    });

    if (loginResponse.body.token) {
      authToken = loginResponse.body.token;
      userId = loginResponse.body.user?.id;
    }

    const cartResponse = await request(app)
      .post("/api/cart/add")
      .set("Authorization", `${authToken}`)
      .send({
        product: "507f1f77bcf86cd799439011",
        quantity: 2,
        price: 99.99,
      });

    testCartId = cartResponse.body.cartId; 
  });

  describe("POST /api/order/add", () => {
    // test("should create an order with authentication", async () => {
    //   const orderData = {
    //     cartId: testCartId,
    //     total: 199.98, 
    //   };

    //   const response = await request(app)
    //     .post("/api/order/add")
    //     .set("Authorization", `${authToken}`)
    //     .send(orderData);

    //   expect(response.status).toBe(200);
    //   expect(response.body).toHaveProperty("success", true);
    //   expect(response.body).toHaveProperty("order");
    //   testOrderId = response.body.order._id;
    // });

    test("should reject creating order without authentication", async () => {
      const orderData = {
        cartId: testCartId,
        total: 199.98,
      };

      const response = await request(app).post("/api/order/add").send(orderData);
      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/order/search", () => {
    test("should search for orders by ID", async () => {
      const response = await request(app)
        .get(`/api/order/search?search=${testOrderId}`)
        .set("Authorization", ` ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.orders).toBeInstanceOf(Array);
    });

    test("should return an empty array for invalid order ID", async () => {
      const response = await request(app)
        .get(`/api/order/search?search=invalid-order-id`)
        .set("Authorization", ` ${authToken}`);

      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/order/:orderId", () => {
    // test("should fetch a specific order with authentication", async () => {
    //   const response = await request(app)
    //     .get(`/api/order/${testOrderId}`)
    //     .set("Authorization", ` ${authToken}`);

    //   expect(response.status).toBe(200);
    //   expect(response.body).toHaveProperty("order");
    //   expect(response.body.order._id).toBe(testOrderId);
    // });

    test("should reject fetching order without authentication", async () => {
      const response = await request(app).get(`/api/order/${testOrderId}`);
      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/order/me", () => {
    test("should fetch orders for the authenticated user", async () => {
      const response = await request(app)
        .get("/api/order/me")
        .set("Authorization", ` ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.orders).toBeInstanceOf(Array);
    });

    test("should reject fetching orders without authentication", async () => {
      const response = await request(app).get("/api/order/me");
      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/order/cancel/:orderId", () => {
    // test("should cancel an order with authentication", async () => {
    //   const response = await request(app)
    //     .delete(`/api/order/cancel/${testOrderId}`)
    //     .set("Authorization", ` ${authToken}`);

    //   expect(response.status).toBe(200);
    //   expect(response.body).toHaveProperty("success", true);
    // });

    test("should reject canceling order without authentication", async () => {
      const response = await request(app).delete(`/api/order/cancel/${testOrderId}`);
      expect(response.status).toBe(401);
    });
  });
});

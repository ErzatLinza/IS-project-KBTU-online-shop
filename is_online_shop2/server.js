require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 3000);
app.use(express.json({ limit: "20kb" }));
const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "kbtu_shop",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1 FROM categories LIMIT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    console.error("DB unavailable:", err.message);
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const result = await pool.query("SELECT category_id AS id, category_name AS name FROM categories ORDER BY category_id");
    res.json(result.rows);
  } catch (err) {
    console.error("Categories error:", err.message);
    res.status(500).json({ error: "Could not load categories." });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.product_id AS id, p.product_name AS name, p.price,
             p.stock_quantity AS stock, c.category_name AS category
      FROM products p
      LEFT JOIN categories c ON c.category_id = p.category_id
      ORDER BY p.product_id`);
    res.json(result.rows);
  } catch (err) {
    console.error("Products error:", err.message);
    res.status(500).json({ error: "Could not load products." });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.order_id AS id, c.full_name AS customer, c.email,
             o.status, o.total_amount AS total, o.order_date AS date,
             COALESCE(json_agg(json_build_object(
                'name', p.product_name, 'quantity', oi.quantity, 'price', oi.price
             ) ORDER BY oi.order_item_id) FILTER (WHERE oi.order_item_id IS NOT NULL), '[]'::json) AS items
      FROM orders o
      JOIN customers c ON c.customer_id = o.customer_id
      LEFT JOIN order_items oi ON oi.order_id = o.order_id
      LEFT JOIN products p ON p.product_id = oi.product_id
      GROUP BY o.order_id, c.customer_id
      ORDER BY o.order_id DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error("Orders error:", err.message);
    res.status(500).json({ error: "Could not load orders." });
  }
});

app.post("/api/orders", async (req, res) => {
  const customerName = typeof req.body?.customerName === "string" ? req.body.customerName.trim() : "";
  const customerEmail = typeof req.body?.customerEmail === "string" ? req.body.customerEmail.trim().toLowerCase() : "";
  const rawItems = req.body?.items;
  if (!customerName || customerName.length > 100 || customerEmail.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) ||
      !Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 100) {
    return res.status(400).json({ error: "Provide a valid name, email and cart." });
  }
  const quantities = new Map();
  for (const item of rawItems) {
    const id = item && item.productId;
    const quantity = item && item.quantity;
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      return res.status(400).json({ error: "Invalid cart item." });
    }
    quantities.set(id, (quantities.get(id) || 0) + quantity);
    if (quantities.get(id) > 99) return res.status(400).json({ error: "Quantity limit exceeded." });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const items = [];
    let total = 0;
    // Consistent ID order prevents deadlocks between simultaneous checkouts.
    for (const [id, quantity] of [...quantities.entries()].sort((a,b) => a[0]-b[0])) {
      const productResult = await client.query(
        "SELECT product_id, product_name, price, stock_quantity FROM products WHERE product_id = $1 FOR UPDATE", [id]);
      const product = productResult.rows[0];
      if (!product || product.stock_quantity < quantity) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Product is unavailable or stock is insufficient." });
      }
      const price = Number(product.price);
      total += price * quantity;
      items.push({ product, quantity, price });
    }
    // Reuse the same email; new customers are created only once.
    const customerResult = await client.query(`
      INSERT INTO customers (full_name, email) VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING customer_id`, [customerName, customerEmail]);
    const customerId = customerResult.rows[0].customer_id;
    const orderResult = await client.query(`
      INSERT INTO orders (customer_id, total_amount, status)
      VALUES ($1, $2, 'Pending') RETURNING order_id AS id, total_amount AS total,
      status, order_date AS date`, [customerId, total]);
    const order = orderResult.rows[0];
    for (const item of items) {
      await client.query("UPDATE products SET stock_quantity = stock_quantity - $1 WHERE product_id = $2",
        [item.quantity, item.product.product_id]);
      await client.query(`INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES ($1, $2, $3, $4)`, [order.id, item.product.product_id, item.quantity, item.price]);
    }
    await client.query("COMMIT");
    res.status(201).json({ ...order, customer: customerName, email: customerEmail,
      items: items.map(x => ({ name: x.product.product_name, quantity: x.quantity, price: x.price })) });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Checkout error:", err.message);
    res.status(500).json({ error: "Could not save order." });
  } finally {
    if (client) client.release();
  }
});

app.post("/api/products", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const category = typeof req.body?.category === "string" ? req.body.category : "";
  const price = req.body?.price;
  const stock = req.body?.stock;
  if (!name || name.length > 100 || !Number.isFinite(price) || price <= 0 || price > 99999999.99 ||
      !Number.isSafeInteger(stock) || stock < 0 || !category) {
    return res.status(400).json({ error: "Invalid product data." });
  }
  try {
    const result = await pool.query(`
      INSERT INTO products (product_name, price, stock_quantity, category_id)
      SELECT $1, $2, $3, category_id FROM categories WHERE category_name = $4
      RETURNING product_id AS id, product_name AS name, price, stock_quantity AS stock`,
      [name, price, stock, category]);
    if (!result.rowCount) return res.status(400).json({ error: "Unknown category." });
    res.status(201).json({ ...result.rows[0], category });
  } catch (err) {
    console.error("Add product error:", err.message);
    res.status(500).json({ error: "Could not create product." });
  }
});

app.patch("/api/products/:id/stock", async (req, res) => {
  const id = Number(req.params.id);
  const amount = req.body?.amount;
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(amount) || ![-1,1].includes(amount)) {
    return res.status(400).json({ error: "Invalid ID or stock change." });
  }
  try {
    const result = await pool.query(`UPDATE products SET stock_quantity = stock_quantity + $1
      WHERE product_id = $2 AND stock_quantity + $1 >= 0
      RETURNING product_id AS id, stock_quantity AS stock`, [amount, id]);
    if (!result.rowCount) return res.status(409).json({ error: "Product not found or stock cannot be negative." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Stock update error:", err.message);
    res.status(500).json({ error: "Could not update stock." });
  }
});

// Order status management: Pending -> Paid -> Shipped -> Delivered.
app.patch("/api/orders/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  const statuses = ["Pending", "Paid", "Shipped", "Delivered"];
  if (!Number.isSafeInteger(id) || id <= 0 || !statuses.includes(status)) {
    return res.status(400).json({ error: "Invalid order ID or status." });
  }
  try {
    const result = await pool.query(
      `UPDATE orders SET status = $1 WHERE order_id = $2
       RETURNING order_id AS id, status`, [status, id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Order not found." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Order status error:", err.message);
    res.status(500).json({ error: "Could not update order status." });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.listen(port, () => console.log(`KBTU Campus Store: http://localhost:${port}`));

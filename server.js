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
        await pool.query("SELECT 1");
        res.json({ status: "ok", database: "connected" });
    } catch (error) {
        console.error("Database health check failed:", error.message);
        res.status(503).json({ status: "error", database: "unavailable" });
    }
});

app.get("/api/products", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                products.id,
                products.sku,
                products.name,
                products.description,
                products.price,
                products.stock,
                products.image_url,
                categories.name AS category
            FROM products
            JOIN categories ON categories.id = products.category_id
            WHERE products.is_active = TRUE
            ORDER BY products.id
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("Could not read products:", error.message);
        res.status(500).json({ error: "Could not load products from the database." });
    }
});

app.get("/api/orders", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                orders.id,
                orders.customer_name AS customer,
                orders.customer_email AS email,
                orders.status,
                orders.total,
                orders.created_at AS date,
                COALESCE(
                    json_agg(json_build_object(
                        'name', order_items.product_name,
                        'quantity', order_items.quantity,
                        'price', order_items.unit_price
                    ) ORDER BY order_items.id) FILTER (WHERE order_items.id IS NOT NULL),
                    '[]'::json
                ) AS items
            FROM orders
            LEFT JOIN order_items ON order_items.order_id = orders.id
            GROUP BY orders.id
            ORDER BY orders.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("Could not read orders:", error.message);
        res.status(500).json({ error: "Could not load orders from the database." });
    }
});

app.post("/api/orders", async (req, res) => {
    const customerName = String(req.body?.customerName || "").trim();
    const customerEmail = String(req.body?.customerEmail || "").trim();
    const rawItems = req.body?.items;
    if (!customerName || customerName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || !Array.isArray(rawItems) || rawItems.length === 0) {
        return res.status(400).json({ error: "Enter a valid name, email and at least one item." });
    }

    const quantities = new Map();
    for (const item of rawItems) {
        const productId = Number(item.productId);
        const quantity = Number(item.quantity);
        if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
            return res.status(400).json({ error: "One or more cart items are invalid." });
        }
        quantities.set(productId, (quantities.get(productId) || 0) + quantity);
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const checkedItems = [];
        let total = 0;
        for (const [productId, quantity] of quantities) {
            const productResult = await client.query(
                "SELECT id, name, price, stock FROM products WHERE id = $1 AND is_active = TRUE FOR UPDATE",
                [productId]
            );
            const product = productResult.rows[0];
            if (!product || product.stock < quantity) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "An item is unavailable in the requested quantity. Refresh the catalog and try again." });
            }
            const price = Number(product.price);
            total += price * quantity;
            checkedItems.push({ product, quantity, price });
        }

        const orderResult = await client.query(
            `INSERT INTO orders (customer_name, customer_email, total)
             VALUES ($1, $2, $3)
             RETURNING id, customer_name AS customer, customer_email AS email, status, total, created_at AS date`,
            [customerName, customerEmail, total]
        );
        const order = orderResult.rows[0];
        for (const item of checkedItems) {
            await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [item.quantity, item.product.id]);
            await client.query(
                `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price)
                 VALUES ($1, $2, $3, $4, $5)`,
                [order.id, item.product.id, item.product.name, item.quantity, item.price]
            );
        }
        await client.query("COMMIT");
        order.items = checkedItems.map(item => ({ name: item.product.name, quantity: item.quantity, price: item.price }));
        res.status(201).json(order);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("Could not place order:", error.message);
        res.status(500).json({ error: "Could not save the order. Please try again." });
    } finally {
        client.release();
    }
});

app.post("/api/products", async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const category = String(req.body?.category || "");
    const price = Number(req.body?.price);
    const stock = Number(req.body?.stock);
    if (!name || name.length > 160 || !["Apparel", "Accessories", "Stationery"].includes(category) || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({ error: "Enter a name, supported category, positive price and valid stock quantity." });
    }
    try {
        const result = await pool.query(
            `INSERT INTO products (sku, name, category_id, price, stock)
             SELECT $1, $2, categories.id, $3, $4
             FROM categories WHERE categories.name = $5
             RETURNING id, sku, name, price, stock`,
            [`KBTU-${Date.now()}`, name, price, stock, category]
        );
        if (!result.rowCount) return res.status(400).json({ error: "Product category is missing from the database." });
        res.status(201).json({ ...result.rows[0], category });
    } catch (error) {
        console.error("Could not add product:", error.message);
        res.status(500).json({ error: "Could not add the product." });
    }
});

app.patch("/api/products/:id/stock", async (req, res) => {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(amount) || Math.abs(amount) !== 1) {
        return res.status(400).json({ error: "A product ID and a stock change of +1 or -1 are required." });
    }
    try {
        const result = await pool.query(
            "UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock + $1 >= 0 RETURNING id, stock",
            [amount, id]
        );
        if (!result.rowCount) return res.status(409).json({ error: "Product was not found or stock cannot go below zero." });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Could not change stock:", error.message);
        res.status(500).json({ error: "Could not update product stock." });
    }
});

app.patch("/api/orders/:id/status", async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || "");
    if (!Number.isInteger(id) || id <= 0 || !["Confirmed", "Processing", "Shipped", "Delivered"].includes(status)) {
        return res.status(400).json({ error: "A valid order ID and status are required." });
    }
    try {
        const result = await pool.query(
            "UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status",
            [status, id]
        );
        if (!result.rowCount) return res.status(404).json({ error: "Order not found." });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Could not change order status:", error.message);
        res.status(500).json({ error: "Could not update order status." });
    }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/styles.css", (req, res) => res.sendFile(path.join(__dirname, "styles.css")));
app.get("/app.js", (req, res) => res.sendFile(path.join(__dirname, "app.js")));

app.listen(port, () => {
    console.log(`KBTU Campus Store is running at http://localhost:${port}`);
});

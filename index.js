const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const supabase = require("@supabase/supabase-js");
const pdf = require("pdfkit");
const fs = require("fs");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;

// middlewares
app.use(cors());
app.use(express.json());

const supabaseClient = supabase.createClient(
  "https://fbreoonkhaqatovmaorj.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZicmVvb25raGFxYXRvdm1hb3JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY0ODg5MDEsImV4cCI6MjA1MjA2NDkwMX0.XiaLdYmmNNTJnk-vTxNqG6IzwQMLAMmB65Mq3kRVBGs"
);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri =
  "mongodb+srv://payguard:2yG5IbhsRRJNfdA7@payguard.yg0uc.mongodb.net/?retryWrites=true&w=majority&appName=PayGuard&tls=true&tlsAllowInvalidCertificates=true";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("PayGuard");
    const usersCollection = database.collection("users");
    const paymentsCollection = database.collection("payments");
    const documentsCollection = database.collection("documents");

    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { price } = req.body;
        const amount = price * 100;

        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        // console.error("Error creating PaymentIntent:", error.message);
        res.status(500).send({ error: "Failed to create PaymentIntent" });
      }
    });
    app.post("/payments", async (req, res) => {
      try {
        const payment = req.body;
        const paymentResult = await paymentsCollection.insertOne(payment);
        res.send(paymentResult);
      } catch (error) {
        res.status(500).send({ error: "Failed to save payment" });
      }
    });
    app.get("/payments/:userId", async (req, res) => {
      const { userId } = req.params; // Get userId from query parameters

      if (!userId) {
        return res.status(400).send({ message: "User ID is required" });
      }

      try {
        const payments = await paymentsCollection
          .find({ user_id: userId })
          .toArray();
        res.status(200).send(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({ message: "Failed to fetch payments", error });
      }
    });

    // GET: Retrieve all payments (for admin) or user-specific payments
    app.get("/payments", async (req, res) => {
      try {
        const payments = await paymentsCollection.find().toArray();
        res.status(200).send(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({ message: "Failed to fetch payments", error });
      }
    });

    app.post("/documents", async (req, res) => {
      const { fileUrl, status, user_id } = req.body;

      try {
        const document = {
          user_id: user_id,
          file_url: fileUrl,
          status: status || "pending",
          uploaded_at: new Date(),
        };

        const result = await documentsCollection.insertOne(document);
        res.status(201).send({
          message: "Document uploaded successfully",
          document: result,
        });
      } catch (error) {
        console.error("Error uploading document:", error);
        res.status(500).send({ message: "Failed to upload document", error });
      }
    });

    app.put("/documents/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).send({ message: "Status is required" });
      }

      try {
        const objectId = ObjectId.createFromHexString(id); // Use 'new' here

        // Update payment status
        const result = await documentsCollection.updateOne(
          { _id: objectId },
          { $set: { status } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: "status already updated" });
        }

        res
          .status(200)
          .send({ message: "Payment status updated successfully" });
      } catch (error) {
        console.error("Error updating payment status:", error);
        res
          .status(500)
          .send({ message: "Failed to update payment status", error });
      }
    });

    app.get("/documents/:userId", async (req, res) => {
      const { userId } = req.params; // Get userId from query parameters

      if (!userId) {
        return res.status(400).send({ message: "User ID is required" });
      }

      try {
        const documents = await documentsCollection
          .find({ user_id: userId })
          .toArray();
        res.status(200).send(documents);
      } catch (error) {
        console.error("Error fetching documents:", error);
        res.status(500).send({ message: "Failed to fetch documents", error });
      }
    });

    app.get("/documents", async (req, res) => {
      try {
        const documents = await documentsCollection.find().toArray();
        res.status(200).send(documents);
      } catch (error) {
        console.error("Error fetching documents:", error);
        res.status(500).send({ message: "Failed to fetch documents", error });
      }
    });

    app.get("/invoice/:paymentId", async (req, res) => {
      const { paymentId } = req.params;

      try {
        // Create ObjectId using the new method
        const objectId = new ObjectId(paymentId);

        const payment = await paymentsCollection.findOne({ _id: objectId });

        if (!payment || payment.status !== "approved") {
          return res
            .status(404)
            .send({ message: "Invoice not available for this payment" });
        }

        const invoiceName = `invoice_${paymentId}.pdf`;
        const invoiceDir = path.join(__dirname, "invoices");
        const invoicePath = path.join(invoiceDir, invoiceName);

        // Ensure the 'invoices' directory exists
        if (!fs.existsSync(invoiceDir)) {
          fs.mkdirSync(invoiceDir, { recursive: true });
        }

        // Generate the PDF
        const doc = new pdf();
        doc.pipe(fs.createWriteStream(invoicePath));
        doc.pipe(res);

        doc.fontSize(18).text("Invoice", { align: "center" });
        doc.text("\n");
        doc.fontSize(12).text(`Invoice ID: ${paymentId}`);
        doc.text(`User ID: ${payment.user_id}`);
        doc.text(`Title: ${payment.title}`);
        doc.text(`Amount: $${payment.amount}`);
        doc.text(`Date: ${new Date(payment.created_at).toLocaleString()}`);
        doc.text("\n");
        doc.text("Thank you for your payment!", { align: "center" });

        doc.end();
      } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(500).send({ message: "Failed to generate invoice" });
      }
    });

    // PUT: Update payment status
    app.put("/payments/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).send({ message: "Status is required" });
      }

      try {
        const objectId = ObjectId.createFromHexString(id); // Use 'new' here

        // Update payment status
        const result = await paymentsCollection.updateOne(
          { _id: objectId },
          { $set: { status } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: "status already updated" });
        }

        res
          .status(200)
          .send({ message: "Payment status updated successfully" });
      } catch (error) {
        console.error("Error updating payment status:", error);
        res
          .status(500)
          .send({ message: "Failed to update payment status", error });
      }
    });

    // POST: Add a new user
    app.post("/users", async (req, res) => {
      const user = req.body;

      try {
        const result = await usersCollection.insertOne(user);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error inserting user:", error);
        res.status(500).send({ message: "Failed to insert user", error });
      }
    });

    // GET: Retrieve all users
    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.status(200).send(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ message: "Failed to fetch users", error });
      }
    });

    app.get("/users/:email", async (req, res) => {
      const { email } = req.params;

      try {
        const user = await usersCollection.findOne({ email: email });
        if (user) {
          res.status(200).send(user);
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).send({ message: "Failed to fetch user", error });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //   await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("server site is running");
});
app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});

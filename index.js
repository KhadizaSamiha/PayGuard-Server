const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const supabase = require("@supabase/supabase-js");
const pdf = require("pdfkit");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const app = express();
const port = process.env.PORT || 3000;

// middlewares
app.use(cors());
app.use(express.json());

const supabaseClient = supabase.createClient(
  "https://fbreoonkhaqatovmaorj.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZicmVvb25raGFxYXRvdm1hb3JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY0ODg5MDEsImV4cCI6MjA1MjA2NDkwMX0.XiaLdYmmNNTJnk-vTxNqG6IzwQMLAMmB65Mq3kRVBGs"
);

// connect to mongodb
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri =
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@payguard.yg0uc.mongodb.net/?retryWrites=true&w=majority&appName=PayGuard&tls=true&tlsAllowInvalidCertificates=true`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const database = client.db("PayGuard");
    const usersCollection = database.collection("users");
    const paymentsCollection = database.collection("payments");
    const documentsCollection = database.collection("documents");

    // Nodemailer Transporter setup
    const transporter = nodemailer.createTransport({
      service: "gmail", 
      auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS,
      },
    });

    // Function to send email when payment status changes
    function sendStatusEmail(userEmail, status) {
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: userEmail,
        subject: "Payment Status Update",
        text: `Dear Customer,\n\nYour payment status has been updated to: ${status}.\n\nThank you for using our service.`,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.log("Error sending email:", error);
        } else {
          console.log("Email sent: " + info.response);
        }
      });
    }

    // create payment intent
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
        res.status(500).send({ error: "Failed to create PaymentIntent" });
      }
    });

    // post payments
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
      const { userId } = req.params; 

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

    // Retrieve all payments 
    app.get("/payments", async (req, res) => {
      try {
        const payments = await paymentsCollection.find().toArray();
        res.status(200).send(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({ message: "Failed to fetch payments", error });
      }
    });

    // post documents
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

    // update documents status
    app.put("/documents/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).send({ message: "Status is required" });
      }

      try {
        const objectId = ObjectId.createFromHexString(id);

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

    // get documents by id
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

    // get all documents
    app.get("/documents", async (req, res) => {
      try {
        const documents = await documentsCollection.find().toArray();
        res.status(200).send(documents);
      } catch (error) {
        console.error("Error fetching documents:", error);
        res.status(500).send({ message: "Failed to fetch documents", error });
      }
    });

    // invoice for payment
    app.get("/invoice/:paymentId", async (req, res) => {
      const { paymentId } = req.params;

      try {
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

    // Update payment status
    app.put("/payments/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).send({ message: "Status is required" });
      }

      try {
        const objectId = new ObjectId(id); // Create objectId from the ID string

        // Find the payment to get the user's email
        const payment = await paymentsCollection.findOne({ _id: objectId });
        if (!payment) {
          return res.status(404).send({ message: "Payment not found" });
        }

        // Update payment status
        const result = await paymentsCollection.updateOne(
          { _id: objectId },
          { $set: { status } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: "Status already updated" });
        }

        // Send email to the user
        sendStatusEmail(payment.email, status);

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

    // Add a new user
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

    // Retrieve all users
    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.status(200).send(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ message: "Failed to fetch users", error });
      }
    });

    // get user by email
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

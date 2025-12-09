const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
const port = 3000;

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.orfhois.mongodb.net/?appName=Cluster0`;

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

    const db = client.db("chef-hut");
    const userCollection = db.collection("users");
    const mealsCollection = db.collection("meals");
    //    upload user in db
    app.post("/users", async (req, res) => {
      const users = req.body;
      const result = await userCollection.insertOne(users);
      res.send(result);
    });

    // get featured meals from db
    app.get("/featured-meals", async (req, res) => {
      const meals = await mealsCollection.find().limit(6).toArray();
      res.send(meals);
    });

    // all meals from db
    app.get("/meals", async (req, res) => {
      try {
        const {
          limit = 10,
          skip = 0,
          sort = "createdAt",
          order = "desc",
          search = "",
        } = req.query;

        const query = search
          ? {
              foodName: { $regex: search, $options: "i" },
            }
          : {};

        const sortOption = {};
        sortOption[sort] = order === "asc" ? 1 : -1;

        const meals = await mealsCollection
          .find(query)
          .project({
            foodName: 1,
            foodImage: 1,
            price: 1,
            rating: 1,
            chefName: 1,
            chefId: 1,
            deliveryArea: 1,
            createdAt: 1,
          })
          .sort(sortOption)
          .skip(Number(skip))
          .limit(Number(limit))
          .toArray();

        const total = await mealsCollection.countDocuments(query);

        res.send({ meals, total });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Server Error" });
      }
    });

    
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

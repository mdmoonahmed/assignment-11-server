const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId, ChangeStream } = require("mongodb");

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
    const reviewCollection = db.collection("reviews");
    const favoriteCollection = db.collection("favorites");
    const orderCollection = db.collection("orders");
    const requestCollection = db.collection("requests")




    /************Request For Admin or Chef*****************/ 
    // Post / requests
app.post("/requests", async (req, res) => {
  try {
    const { userId, userName, userEmail, requestType } = req.body;

    // Basic validation
    if (!userEmail || !requestType || !userName) {
      return res.status(400).json({ error: "userName, userEmail and requestType are required." });
    }
    if (!["chef", "admin"].includes(requestType)) {
      return res.status(400).json({ error: "requestType must be 'chef' or 'admin'." });
    }

    // prevent duplicate pending request of same type
    const existing = await requestCollection.findOne({
      userEmail: String(userEmail),
      requestType,
      requestStatus: "pending"
    });
    if (existing) {
      return res.status(409).json({ error: "You already have a pending request of this type." });
    }

    const doc = {
      userId: userId ? String(userId) : null,
      userName: String(userName),
      userEmail: String(userEmail),
      requestType,
      requestStatus: "pending",
      requestTime: new Date().toISOString(),
    };

    const result = await requestCollection.insertOne(doc);
    return res.status(201).json({ insertedId: result.insertedId, request: doc });
  } catch (err) {
    console.error("POST /requests error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


    /***********User Database***************/
        // GET /users/:email/role
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;           
        if (!email) return res.status(400).json({ error: "email required" });
    
        const query = { email: String(email) };
        const user = await userCollection.findOne(query); 
    
        return res.json({ role: user?.role || "user" });
      } catch (err) {
        console.error("GET /users/:email/role error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    });


    //    Post/ user 
    app.post("/users", async (req, res) => {
      const users = req.body;
      const result = await userCollection.insertOne(users);
      res.send(result);
    });

  /******************Favorites Database**********************/  
  //  Post / favorites
 // POST /favorites
app.post("/favorites", async (req, res) => {
  try {
    const { userEmail, mealId, mealName, chefId, chefName, price } = req.body;

    if (!userEmail || !mealId || !chefId) {
      return res.status(400).json({
        error: "userEmail, mealId and chefId are required.",
      });
    }

    // prevent duplicate favorite
    const exists = await favoriteCollection.findOne({
      userEmail: String(userEmail),
      mealId: String(mealId),
    });

    if (exists) {
      return res.status(409).json({
        error: "Meal already added to favorites.",
      });
    }

    const doc = {
      userEmail: String(userEmail),
      mealId: String(mealId),
      mealName: String(mealName || ""),
      chefId: String(chefId),
      chefName: String(chefName || ""),
      price: Number(price || 0),
      addedTime: new Date().toISOString(),
    };

    const result = await favoriteCollection.insertOne(doc);
    await favoriteCollection.createIndex(
   { userEmail: 1, mealId: 1 },
   { unique: true }
   );


    return res.status(201).json({
      insertedId: result.insertedId,
      favorite: doc,
    });
  } catch (err) {
    console.error("POST /favorites error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

  /***********************Orders Database************************/  
  // Post / orders
  app.post("/orders", async(req,res) => {
      try{
          const {  foodId,price,quantity,paymentStatus= 'Pending',userAddress,orderStatus = 'pending', mealName,userEmail, chefId,  } = req.body;
           if (!userEmail || !foodId ||!userAddress||!paymentStatus ||!orderStatus || !chefId) {
              return res.status(400).json({
              error: "userEmail, foodId,userAddress,paymentStatus,orderStatus and chefId are required.",
      });
    }  

       const doc = {
          foodId: String(foodId),
          mealName: String(mealName),
          price: Number(price),
          quantity: Number(quantity),
          chefId: String(chefId),
          paymentStatus: String(paymentStatus),
          userEmail: String(userEmail),
          userAddress: String(userAddress),
          orderStatus: String(orderStatus),
          orderTime: new Date().toISOString(),
       }

       const order =await orderCollection.insertOne(doc);
       return res.status(201).json({
      insertedId: order.insertedId,
      order: doc,
      });


      }
      catch(err){
             console.error("POST /orders error:", err);
            return res.status(500).json({ error: "Internal server error" });
      }
  })

    /****************reviews database*************************/ 

    // POST /reviews
app.post("/reviews", async (req, res) => {
  try {
    const { foodId, reviewerName, reviewerImage, rating, comment } = req.body;

    // basic validation
    if (!foodId || !reviewerName || typeof rating === "undefined" || !comment) {
      return res.status(400).json({ error: "foodId, reviewerName, rating and comment are required." });
    }

    const parsedRating = Number(rating);
    if (Number.isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5) {
      return res.status(400).json({ error: "rating must be a number between 0 and 5." });
    }

    const doc = {
      foodId: String(foodId),
      reviewerName: String(reviewerName),
      reviewerImage: reviewerImage ? String(reviewerImage) : "",
      rating: parsedRating,
      comment: String(comment),
      date: new Date().toISOString(), 
    };

    const result = await reviewCollection.insertOne(doc);
    return res.status(201).json({ insertedId: result.insertedId, review: doc });
  } catch (err) {
    console.error("POST /reviews error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
  
  // GET /reviews/home
app.get("/reviews/home", async (req, res) => {
  try {
    const {limit} = req.query;
    // const limit = Math.min(50, Math.max(1, parseInt(raw ?? "6", 10)));

    const reviews = await reviewCollection
      .find({})
      .sort({ date: -1 })
      .limit(Number(limit))
      .toArray();

    return res.json(reviews);
  } catch (err) {
    console.error("GET /reviews/home error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


  // GET /reviews?foodId
app.get("/reviews", async (req, res) => {
  try {
    const foodId = req.query.foodId;
    if (!foodId) {
      return res.status(400).json({ error: "foodId query parameter is required." });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, parseInt(req.query.limit || "20", 10));
    const skip = (page - 1) * limit;

    const query = { foodId: String(foodId) };

    const projection = {
      foodId: 1,
      reviewerName: 1,
      reviewerImage: 1,
      rating: 1,
      comment: 1,
      date: 1,
    };

    const cursor = reviewCollection
      .find(query)
      .project(projection)
      .sort({ date: -1 }) 
      .skip(skip)
      .limit(limit);

    const reviews = await cursor.toArray();
    const total = await reviewCollection.countDocuments(query);

    return res.json({ reviews, total, page, limit });
  } catch (err) {
    console.error("GET /reviews error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});






    /****************meals database*************************/ 

    // get featured meals from db
    app.get("/featured-meals", async (req, res) => {
      const meals = await mealsCollection.find()
      .limit(6)
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
      .toArray();
      res.send(meals);
    });
    // meals details
    app.get("/meals/:id",async (req, res) => {
       const {id} = req.params;
       const objectId = new ObjectId(id);

       const result = await mealsCollection.findOne({_id: objectId});
       res.send(result)
       
    })

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

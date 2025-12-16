const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId, ChangeStream } = require("mongodb");
const stripe = require('stripe')(process.env.STRIPE_SECURE);

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


    /*****************Payment**********************/ 
    //  Patch / payment-succes?session_id=
    app.patch("/payment-success", async(req,res) => {
       const {session_id} = req.query;
       if(!session_id){
        return res.status(400).json("session_id required")
       }
       const session = await  stripe.checkout.sessions.retrieve(req.query.session_id);
       console.log("session retrieve",session);
       if(session.payment_status === 'paid'){
          const id = session.metadata.foodId;
          const query = {_id : new ObjectId(id)};
          const update = {
            $set: {
               paymentStatus: "Paid",
            }
          }
          const result = await orderCollection.updateOne(query,update);
          res.send({ success : true})
       }
       res.send({ success : false})
       
    })


    // Create checkout-session 
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { mealName, foodId, email, price } = req.body;

    if (!mealName || !foodId || !email || !price) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const usdRate = 127.0827;
    const amount = Math.round(Number(price / usdRate) * 100);

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid price" });
    }

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: "usd",  
            product_data: {
              name: `Please pay for ${mealName}`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: {              
        foodId,
      },
      customer_email: email,
      mode: "payment",
      success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
    });

    res.send({ url: session.url });
  } catch (error) {
    console.error("Stripe Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});


    /*****************Order Database***************************/ 
// PATCH /orders/:id
app.patch("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { orderStatus } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    const allowedStatus = ["pending", "accepted", "delivered", "cancelled"];
    if (!allowedStatus.includes(orderStatus)) {
      return res.status(400).json({ error: "Invalid order status" });
    }

    const query = { _id: new ObjectId(id) };

    const updateDoc = {
      $set: {
        orderStatus: String(orderStatus),
      },
    };

    const result = await orderCollection.updateOne(query, updateDoc);

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    return res.json({
      success: true,
      message: "Order status updated successfully",
    });
  } catch (err) {
    console.error("PATCH /orders/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});



    // Get / orders/chef?chefId=
    app.get("/orders/chef",async(req,res) => {
      try{
         const {chefId } = req.query;
         if(!chefId){
          return res.status(400).json("chefId required");
         }
         const query = { chefId : String(chefId) }
         const orders = await orderCollection.find(query).toArray();
         return res.json(orders)
      }
      catch(err){
         console.error('Get/orders/chef error:',err);
         return res.status(500).json({error:"Internal server error"})
      }
    })


    // Get / orders?email=
    app.get("/orders", async(req,res) => {
      try {
         const {email} = req.query;
         const query = {} ;
         if(email) query.userEmail = String(email);
        //  if(!email){
        //   return res.status(400).json({ error: "email is required"});
        //  }

         const cursor = orderCollection.find(query);
         const orders =await cursor.toArray();
         return res.json(orders)
      }
      catch(err){
          console.error("Get / orders error",err);
          return res.status(500).json({ error: "Internal server error"});
      }
    })


    /************Request For Admin or Chef*****************/ 

    //  PATCH /requests/:id?action=approve OR action=reject

app.patch("/requests/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { action } = req.body; 
    if (!id) return res.status(400).json({ error: "request id required" });
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
    }
    if (!requestCollection || !userCollection) {
      return res.status(500).json({ error: "Server collection not initialized" });
    }

    const reqObjectId = new ObjectId(id);
    const requestDoc = await requestCollection.findOne({ _id: reqObjectId });
    if (!requestDoc) return res.status(404).json({ error: "Request not found" });

    if (requestDoc.requestStatus !== "pending") {
      return res.status(400).json({ error: `Request already ${requestDoc.requestStatus}` });
    }

    const updates = {
      requestStatus: action === "approve" ? "approved" : "rejected",
      reviewedAt: new Date().toISOString(),
      
    };

    // Approve flow: update user role when approving
    let updatedUser = null;
    if (action === "approve") {
      const { userEmail, requestType } = requestDoc;
      const userQuery = { email: String(userEmail) };
      const userDoc = await userCollection.findOne(userQuery);
      if (!userDoc) {
        
        return res.status(404).json({ error: "User document not found for this request" });
      }

      if (requestType === "chef") {
        // generate unique chefId chef-XXXX
        let chefId;
        let tries = 0;
        do {
          const num = Math.floor(1000 + Math.random() * 9000); // 4-digit
          chefId = `chef-${num}`;
          const exists = await userCollection.findOne({ chefId });
          if (!exists) break;
          tries += 1;
        } while (tries < 5);

        const userUpdate = {
          $set: { role: "chef", chefId },
        };
        await userCollection.updateOne(userQuery, userUpdate);
        updatedUser = await userCollection.findOne(userQuery);

      } else if (requestType === "admin") {
        await userCollection.updateOne(userQuery, { $set: { role: "admin" } });
        updatedUser = await userCollection.findOne(userQuery);
      } else {
      }
    }

    // Save request update
    await requestCollection.updateOne(
      { _id: reqObjectId },
      { $set: updates }
    );

    const updatedRequest = await requestCollection.findOne({ _id: reqObjectId });

    return res.json({
      request: updatedRequest,
      updatedUser,
    });
  } catch (err) {
    console.error("PATCH /requests/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


   // GET /requests
app.get("/requests", async (req, res) => {
  try {
    if (!requestCollection) {
      return res.status(500).json({ error: "Server error: requestCollection not initialized." });
    }

    const { userEmail, status, limit = 20, page = 1 } = req.query;

    const q = {};
    if (userEmail) q.userEmail = String(userEmail);
    if (status) q.requestStatus = String(status);

    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const cursor = requestCollection
      .find(q)
      .project({ /* return all fields; change if you want to limit */ })
      .sort({ requestTime: -1 })
      .skip(skip)
      .limit(parsedLimit);

    const requests = await cursor.toArray();
    const total = await requestCollection.countDocuments(q);

    // Return a normalized shape the frontend expects
    return res.json({ requests, total, page: parsedPage, limit: parsedLimit });
  } catch (err) {
    console.error("GET /requests error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});



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

    // GET /users?limit=100
app.get("/users", async (req, res) => {
  try {
    let { limit = 100 } = req.query;
    limit = parseInt(limit);

    const users = await userCollection
      .find() 
      .limit(limit)
      .sort({_id : -1})
      .toArray();

    res.send({ users });
  } catch (err) {
    console.error("GET /users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


    // server snippet: PATCH /users/:id/status

app.patch("/users/:id/status", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body; // expected: "fraud" or "active" or other allowed statuses

    if (!id) return res.status(400).json({ error: "User id is required." });
    if (!status) return res.status(400).json({ error: "Status is required." });

    // optional: validate allowed statuses
    const allowed = ["active", "fraud"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(", ")}` });
    }

    if (!userCollection) {
      return res.status(500).json({ error: "Server configuration error: userCollection not initialized." });
    }

    const userObjectId = new ObjectId(id);

    // find user first
    const existing = await userCollection.findOne({ _id: userObjectId });
    if (!existing) return res.status(404).json({ error: "User not found." });

    // don't allow changing admin status to fraud via this endpoint (safety)
    if (existing.role === "admin" && status === "fraud") {
      return res.status(403).json({ error: "Cannot mark admin as fraud." });
    }

    const result = await userCollection.updateOne(
      { _id: userObjectId },
      { $set: { status: status } }
    );

    if (result.modifiedCount === 0) {
      return res.status(200).json({ message: "No change (status may already be set)." });
    }

    const updated = await userCollection.findOne({ _id: userObjectId });
    return res.json({ message: "User status updated.", user: updated });
  } catch (err) {
    console.error("PATCH /users/:id/status error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


    // GET /users/:email
app.get("/users/:email", async (req, res) => {
  try {
    const email = req.params.email;
    if (!email) {
      return res.status(400).json({ error: "Email parameter is required." });
    }

    if (!userCollection) {
      return res.status(500).json({ error: "Server error: userCollection not initialized." });
    }

    const user = await userCollection.findOne({ email: String(email) });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    return res.json(user);
  } catch (err) {
    console.error("GET /users/:email error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});



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
  // DELETE /favorites/:id
 app.delete("/favorites/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "id required" });

    const result = await favoriteCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Favorite not found" });
    }
    return res.json({ message: "Favorite removed successfully", deletedId: id });
  } catch (err) {
    console.error("DELETE /favorites/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});



  // GET /favorites?email=
app.get("/favorites", async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const favorites = await favoriteCollection
      .find({ userEmail : String(email) })
      .toArray();

    return res.json(favorites);
  } catch (err) {
    console.error("GET /favorites?email error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});



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
          const {  foodId,price,quantity,paymentStatus= 'Pending',userAddress,orderStatus = 'pending', mealName,userEmail, chefId,chefName,estimatedDeliveryTime  } = req.body;
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
          chefName: String(chefName),
          paymentStatus: String(paymentStatus),
          userEmail: String(userEmail),
          userAddress: String(userAddress),
          orderStatus: String(orderStatus),
          estimatedDeliveryTime:String(estimatedDeliveryTime),
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

    /****************Reviews database*************************/ 
// PATCH /reviews/:id
app.patch("/reviews/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    if (!rating && !comment) {
      return res.status(400).json({
        error: "rating or comment required",
      });
    }

    const updateDoc = {
      $set: {
        ...(rating && { rating: Number(rating) }),
        ...(comment && { comment }),
        updatedAt: new Date().toISOString(),
      },
    };

    const result = await reviewCollection.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Review not found" });
    }

    res.json({ message: "Review updated successfully" });
  } catch (err) {
    console.error("PATCH /reviews/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



// DELETE /reviews/:id
app.delete("/reviews/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await reviewCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Review not found" });
    }

    res.json({ message: "Review deleted successfully" });
  } catch (err) {
    console.error("DELETE /reviews/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

  

    // GET /reviews/user?email=
app.get("/reviews/user", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const reviews = await reviewCollection.aggregate([
      {
        $match: { reviewerEmail: email }
      },
      {
        $addFields: {
          foodObjectId: { $toObjectId: "$foodId" }
        }
      },
      {
        $lookup: {
          from: "meals",
          localField: "foodObjectId",
          foreignField: "_id",
          as: "meal"
        }
      },
      {
        $unwind: {
          path: "$meal",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          reviewerName: 1,
          rating: 1,
          comment: 1,
          date: 1,
          foodId: 1,
          mealName: "$meal.foodName"
        }
      }
    ]).toArray();

    res.send(reviews);
  } catch (err) {
    console.error("GET /reviews/user error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});




    // POST /reviews
app.post("/reviews", async (req, res) => {
  try {
    const { foodId,reviewerEmail, reviewerName, reviewerImage, rating, comment } = req.body;

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
      reviewerEmail: String(reviewerEmail),
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
    // Patch / meals/:id
    app.patch("/meals/:id",async(req,res)=>{
        try{
           const {id} = req.params;
           const {foodName,price,ingredients,estimatedDeliveryTime } = req.body;
           if(!foodName && !price && !ingredients && !estimatedDeliveryTime){
            return  res.status(400).json("Nothing to change");
           }
           const query = {_id : new ObjectId(id)};
           const doc = {
              $set:{
                foodName,
                price:Number(price),
                ingredients,
                estimatedDeliveryTime
              }
           }
           const result = await mealsCollection.updateOne(query,doc);
           if(result.matchedCount === 0){
            return res.status(404).json("Meal not found")
           }
           return res.json('Meal updated successfully');
        }
        catch(err){
            console.error("Patch / meals/:id error:",err);
            res.status(500).json("Internal server error")
        }

    })
    

    //  Delete / meals
    app.delete("/meals/:id",async(req,res) => {
       const { id } = req.params;
       const query = { _id: new ObjectId(id)};
       const result = await mealsCollection.deleteOne(query);
       if(result.deletedId === 0){
        return res.status(404).json("Meal not found")
       }
       if(result.deletedCount === 1){
        return res.json("Meal deleted successfully")
       }
    })


    //  Get / meals/chef?email=
    app.get('/meals/chef',async(req,res) => {
      try{
         const email = req.query.email;
         if(!email){
          return res.status(400).json({ error: "Email is required"})
         }
         const query = {userEmail : String(email)};
         const meals = await mealsCollection.find(query).toArray();
         return res.json(meals);
      }
      catch(err){
         return res.status(500).json({ error: "Internal server error"});
      }
    });


    // POST /meals
app.post("/meals", async (req, res) => {
  try {
    const {
      foodName,
      chefName,
      foodImage,
      price,
      rating = 0,
      ingredients,
      estimatedDeliveryTime,
      deliveryArea,
      chefExperience,
      chefId,
      userEmail,
    } = req.body;

    // Basic validation
    if (
      !foodName ||
      !chefName ||
      !foodImage ||
      !price ||
      !ingredients ||
      !estimatedDeliveryTime ||
      !deliveryArea ||
      !chefExperience ||
      !chefId ||
      !userEmail
    ) {
      return res.status(400).json({
        error: "All required fields must be provided.",
      });
    }

    const mealDoc = {
      foodName,
      chefName,
      foodImage,
      price: Number(price),
      rating: Number(rating),
      ingredients: Array.isArray(ingredients) ? ingredients : ingredients.split(","),
      estimatedDeliveryTime,
      deliveryArea,
      chefExperience,
      chefId,
      userEmail,
      createdAt: new Date().toISOString(),
    };

    const result = await mealsCollection.insertOne(mealDoc);

    res.status(201).json({
      message: "Meal created successfully",
      insertedId: result.insertedId,
      meal: mealDoc,
    });
  } catch (err) {
    console.error("POST /meals error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


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

const express = require("express");
const path = require("path");
const morgan = require("morgan");

const submitRoutes = require("./routes/submitRoutes");
// const queryRoutes = require("./routes/queryRoutes");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(morgan("dev"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/", submitRoutes);
// app.use("/", queryRoutes);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Running at http://localhost:${PORT}`);
});
import mongoose from "mongoose";

const exotelTextSchema = new mongoose.Schema({
  ssid: {
    type: String,
    unique: true,
    required: true,
  },
  text: {
    type: String,
    required: true,
  },
});

const ExotelTextModel = mongoose.model("exotel_text", exotelTextSchema);

export default ExotelTextModel;

var selected_mic = false;
var graphs_element = document.getElementById("wrapper");
var mic_button = document.getElementById("mic_button");



mic_button.addEventListener("click",usemic,false);

var worm = {}
var global_stream = {}
var game = {}

function usemic() {
  if(!selected_mic){

    navigator.mediaDevices.enumerateDevices()
        .then(devices => {
          var microphone = devices.find(device => device.kind == "audioinput");
          console.log(microphone)
          if (microphone) {
            var constraints = { deviceId: { exact: "default" } };
            return navigator.mediaDevices.getUserMedia({ audio: constraints });
          }
        })
        .then(stream => micSuccess(stream))
        .catch(e => {console.error(e); micFailure()});
  }
    selected_mic = true;
};


function micSuccess(stream) {
  console.log("mic success")
  console.log(stream)
  global_stream = stream
  worm = new window.VowelWorm.instance(stream);
  game = new window.VowelWorm.Game({element: graphs_element});
  game.addWorm(worm);
  console.log(worm)
};

function micFailure() {
  alert("Could not capture microphone input");
};

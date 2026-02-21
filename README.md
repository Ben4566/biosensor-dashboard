# Biosensor Data Analytics Dashboard

A web-based interactive dashboard built with **D3.js (v7)**. It visualizes physiological time-series data (Heart Rate, Steps, Calories, Temperature) to analyze cardiovascular efficiency and explore the correlation between physical exertion and metabolic output.

## How to Run Locally

Since D3.js loads the dataset (`biosensors.csv`) via a fetch request, opening the HTML file directly in the browser will cause a CORS error. You need a local web server to run it. 

The easiest way is using **Visual Studio Code**:

1. Open this project folder in **VS Code**.
2. Install the **Live Server** extension (by Ritwick Dey) from the VS Code Extensions tab.
3. Open the `index.html` file.
4. Right-click anywhere inside the HTML code and select **"Open with Live Server"** (or click the "Go Live" button in the bottom right corner of VS Code).
5. The dashboard will automatically open in your default web browser.
/**
 * Author: Benedikt Lang
 * Description: D3.js visualization connecting Steps and Heart Rate (HR)
 * with a Heatmap and Scatter Plot, constrained by physiological limits.
 */

const svgWidth = 1100;
const svgHeight = 580;
const margin = { top: 40, right: 180, bottom: 60, left: 60 };
const width = svgWidth - margin.left - margin.right;
const height = svgHeight - margin.top - margin.bottom;

// Central configuration for physiological limits.
// These constants define the boundaries for axes, filtering, and grid calculations.
const PHYSIO_LIMITS = {
    MAX_STEPS_PER_MIN: 200,  // Maximum expected steps per minute (e.g. sprinting)
    MAX_HR: 200,             // Maximum Heart Rate
    MIN_HR: 30,              // Minimum Resting Heart Rate
    MAX_CALORIES_PER_MIN: 20 // Maximum metabolic burn rate
};

// Clear previous SVG elements and tooltips to allow re-running the script
d3.select("svg").selectAll("*").remove();
d3.select(".tooltip").remove();

// Initialize a shared tooltip div (hidden by default)
const tooltip = d3.select("body").append("div")
    .attr("class", "tooltip")
    .style("position", "absolute")
    .style("background", "rgba(0, 0, 0, 0.8)")
    .style("color", "#fff")
    .style("padding", "8px")
    .style("border-radius", "4px")
    .style("pointer-events", "none")
    .style("opacity", 0)
    .style("font-size", "12px")
    .style("z-index", "10");

// Create the main SVG container and group
let svg = d3.select("svg")
    .attr("width", svgWidth)
    .attr("height", svgHeight)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

// Load and process the dataset
d3.csv("data/biosensors.csv").then(function (data) {

    // Convert string values to numbers
    data.forEach(d => { d.Steps = +d.Steps; d.HR = +d.HR; d.Calories = +d.Calories; });

    // Filter data to include only physiologically valid ranges defined in config
    const allData = data.filter(d =>
        d.Steps >= 0 && d.Steps <= PHYSIO_LIMITS.MAX_STEPS_PER_MIN &&
        d.HR > PHYSIO_LIMITS.MIN_HR &&
        d.Calories >= 0 && d.Calories <= PHYSIO_LIMITS.MAX_CALORIES_PER_MIN
    );

    // ------------------------------------------------------------
    // Scales Setup
    // ------------------------------------------------------------

    // X-Axis: Linear scale for Steps (0 to Max Steps)
    const xScale = d3.scaleLinear()
        .domain([0, PHYSIO_LIMITS.MAX_STEPS_PER_MIN])
        .range([0, width]);

    // Y-Axis: Linear scale for Heart Rate (Min HR to Max HR)
    // Note: SVG coordinate system starts at the top, hence range [height, 0]
    const yScale = d3.scaleLinear()
        .domain([PHYSIO_LIMITS.MIN_HR, PHYSIO_LIMITS.MAX_HR])
        .range([height, 0]);

    // Color Scale: Sequential scale for Heatmap (Calories)
    const colorScale = d3.scaleSequential()
        .domain([0, PHYSIO_LIMITS.MAX_CALORIES_PER_MIN])
        .interpolator(d3.interpolateYlOrRd);

    // Radius Scale: Sqrt scale for circle size (Calories)
    // Using sqrt ensures the area of the circle is proportional to the value
    const rScale = d3.scaleSqrt()
        .domain([0, d3.max(allData, d => d.Calories)])
        .range([1.5, 6]);

    // Color Scale for Points: Distinct blue range for individual dots
    const pointColorScale = d3.scaleLinear()
        .domain([0, PHYSIO_LIMITS.MAX_CALORIES_PER_MIN])
        .range(["#add8e6", "#00008b"]);

    // State management for UI toggles
    let isHeatmapVisible = false;
    let isPointsVisible = true;
    let isTrendVisible = false;
    let isZonesVisible = false;
    let isCadenceVisible = false;
    let isBenchmarksVisible = false;

    // ------------------------------------------------------------
    // Legend 
    // ------------------------------------------------------------
    const legendGroup = svg.append("g").attr("transform", `translate(${width + 20}, 20)`);

    // 1. Heatmap Gradient Legend
    const defs = svg.append("defs");
    const lg = defs.append("linearGradient").attr("id", "heatmap-gradient")
        .attr("x1", "0%").attr("y1", "100%") // Vertical gradient
        .attr("x2", "0%").attr("y2", "0%");

    // Create gradient stops based on the color scale
    for (let i = 0; i <= 10; i++) {
        lg.append("stop")
            .attr("offset", `${i / 10 * 100}%`)
            .attr("stop-color", colorScale(i / 10 * PHYSIO_LIMITS.MAX_CALORIES_PER_MIN));
    }

    const hL = legendGroup.append("g");
    hL.append("text").attr("y", -10).text("Heatmap").style("font-size", "11px").style("font-weight", "bold");
    hL.append("rect").attr("width", 15).attr("height", 180).style("fill", "url(#heatmap-gradient)").style("stroke", "#333");
    hL.append("g").attr("transform", "translate(15,0)")
        .call(d3.axisRight(d3.scaleLinear().domain([0, PHYSIO_LIMITS.MAX_CALORIES_PER_MIN]).range([180, 0])).ticks(5));

    // 2. Points Size/Color Legend
    const pL = legendGroup.append("g").attr("transform", "translate(70, 0)");
    pL.append("text").attr("y", -10).text("Points").style("font-size", "11px").style("font-weight", "bold");
    let cY = 20;
    // Draw sample circles for specific calorie values
    [2, 8, 15].forEach(v => {
        let r = rScale(v);
        pL.append("circle").attr("cx", 15).attr("cy", cY).attr("r", r).attr("fill", pointColorScale(v)).attr("stroke", "#555");
        pL.append("text").attr("x", 35).attr("y", cY + 4).text(v).style("font-size", "10px").style("fill", "#555");
        cY += r * 2 + 15;
    });
    pL.append("text").attr("y", cY + 10).text("Size & Color = Cals").style("font-size", "10px").style("font-style", "italic").style("fill", "#777");

    // ------------------------------------------------------------
    // 1. Heatmap (Layer 0 - Bottom)
    // ------------------------------------------------------------
    const xBins = 60; // Number of columns
    const yBins = 30; // Number of rows

    // Calculate the total range of the Y-axis to determine bin height
    const hrRange = PHYSIO_LIMITS.MAX_HR - PHYSIO_LIMITS.MIN_HR;

    // Initialize bins with zero values
    let bins = new Array(xBins * yBins).fill(null).map(() => ({
        sum: 0,
        count: 0,
        val: 0
    }));

    // Calculate the numerical size of each bin
    const xStepSize = PHYSIO_LIMITS.MAX_STEPS_PER_MIN / xBins;
    const yStepSize = hrRange / yBins;

    // Assign each data point to a bin
    allData.forEach(d => {
        let i = Math.floor(d.Steps / xStepSize);
        // Normalize HR by subtracting the minimum limit to find the correct index
        let j = Math.floor((d.HR - PHYSIO_LIMITS.MIN_HR) / yStepSize);

        // Clamp indices to prevent array out-of-bounds errors
        if (i < 0) i = 0; if (i >= xBins) i = xBins - 1;
        if (j < 0) j = 0; if (j >= yBins) j = yBins - 1;

        let index = i * yBins + j;

        bins[index].sum += d.Calories;
        bins[index].count += 1;
    });

    // Convert bins into a format suitable for D3 data binding
    let gridData = [];
    for (let i = 0; i < xBins; i++) {
        for (let j = 0; j < yBins; j++) {
            let index = i * yBins + j;
            let b = bins[index];

            // Only create a rectangle if the bin contains data
            if (b.count > 0) {
                gridData.push({
                    x: i * xStepSize,
                    y: PHYSIO_LIMITS.MIN_HR + j * yStepSize, // Map index back to physiological value
                    val: b.sum / b.count, // Calculate average calories
                    count: b.count
                });
            }
        }
    }

    // Draw Heatmap Rectangles
    svg.selectAll("rect.hm")
        .data(gridData)
        .enter()
        .append("rect")
        .attr("class", "heatmap-rect")
        .attr("x", d => xScale(d.x))
        // Shift Y position to align with the bottom-up scale logic
        .attr("y", d => yScale(d.y + (hrRange / yBins)))
        .attr("width", xScale(PHYSIO_LIMITS.MAX_STEPS_PER_MIN / xBins) - xScale(0))
        // Calculate height by projecting the bin range onto the Y scale
        .attr("height", yScale(PHYSIO_LIMITS.MIN_HR) - yScale(PHYSIO_LIMITS.MIN_HR + hrRange / yBins))
        .attr("fill", d => colorScale(d.val))
        .attr("stroke", "#eee")
        .attr("stroke-width", 0.5)
        .attr("opacity", 0) // Initially hidden
        .style("pointer-events", "none")
        .on("mouseover", function (e, d) {
            d3.select(this).attr("stroke", "black").attr("stroke-width", 2);
            tooltip.transition().duration(200).style("opacity", 0.9);
            tooltip.html(`Heatmap<br>Samples: ${d.count}<br>Ø Cals: <b>${d.val.toFixed(2)}</b>`)
                .style("left", (e.pageX + 10) + "px")
                .style("top", (e.pageY - 28) + "px");
        })
        .on("mouseout", function () {
            d3.select(this).attr("stroke", "#eee").attr("stroke-width", 0.5);
            tooltip.transition().duration(500).style("opacity", 0);
        });

    // ------------------------------------------------------------
    // 2. Scatter Plot (Layer 1 - Middle)
    // ------------------------------------------------------------

    // Sort data descending by Calories so high-value points are rendered on top
    // (or prioritized in the sampling process)
    allData.sort((a, b) => b.Calories - a.Calories);

    const visibleData = [];
    const occupied = new Set();
    const gridSize = 4; // Pixel size for occlusion culling (sampling)

    // Spatial sampling: Only keep one point per pixel grid cell to reduce DOM elements
    allData.forEach(d => {
        const x = xScale(d.Steps);
        const y = yScale(d.HR);

        const gx = Math.floor(x / gridSize);
        const gy = Math.floor(y / gridSize);
        const key = `${gx}-${gy}`;

        if (!occupied.has(key)) {
            occupied.add(key);
            visibleData.push(d);
        }
    });

    const dotsGroup = svg.append("g").attr("id", "points-group");

    dotsGroup.selectAll("circle")
        .data(visibleData)
        .enter()
        .append("circle")
        .attr("cx", d => xScale(d.Steps))
        .attr("cy", d => yScale(d.HR))
        .attr("r", d => rScale(d.Calories))
        .attr("fill", d => pointColorScale(d.Calories))
        .attr("stroke", "white")
        .attr("stroke-width", 0.5)
        .style("cursor", "pointer")
        .on("mouseover", function (e, d) {
            // Highlight point on hover
            d3.select(this)
                .transition().duration(100)
                .attr("r", 8)
                .attr("stroke", "black")
                .attr("stroke-width", 1.5);

            tooltip.transition().duration(200).style("opacity", 0.9);
            tooltip.html(`Point<br>Steps: ${Math.round(d.Steps)}<br>HR: ${Math.round(d.HR)}<br>Cals: ${d.Calories}`)
                .style("left", (e.pageX + 10) + "px")
                .style("top", (e.pageY - 28) + "px");
        })
        .on("mouseout", function (e, d) {
            // Reset style
            d3.select(this)
                .transition().duration(300)
                .attr("r", rScale(d.Calories))
                .attr("stroke", "white")
                .attr("stroke-width", 0.5);

            tooltip.transition().duration(500).style("opacity", 0);
        });

    // ------------------------------------------------------------
    // 3A. Heart Rate Zones (Y-Axis Reference)
    // ------------------------------------------------------------

    // Define standard zones. Adjust values as needed.
    const hrZonesConfig = [
        { val: 60, label: "Resting (60 bpm)", color: "#2ca02c" }, // Green
        { val: 100, label: "Warm Up (100 bpm)", color: "#ff7f0e" }, // Orange
        { val: 135, label: "Cardio (135 bpm)", color: "#d62728" }, // Red
        { val: 165, label: "Peak (165 bpm)", color: "#9467bd" }  // Purple
    ];

    // Create a group for zones and set opacity to 0 initially
    const zonesGroup = svg.append("g")
        .attr("class", "hr-zones-group")
        .attr("opacity", 0);

    hrZonesConfig.forEach(zone => {
        // Only draw if within current Y-Axis domain
        if (zone.val >= PHYSIO_LIMITS.MIN_HR && zone.val <= PHYSIO_LIMITS.MAX_HR) {

            // Draw dashed line
            zonesGroup.append("line")
                .attr("x1", 0)
                .attr("x2", width)
                .attr("y1", yScale(zone.val))
                .attr("y2", yScale(zone.val))
                .attr("stroke", zone.color)
                .attr("stroke-width", 2)
                .attr("stroke-dasharray", "6, 4"); // Dashed pattern

            // Draw Label text
            zonesGroup.append("text")
                .attr("x", width - 5) // Align to right edge inside chart
                .attr("y", yScale(zone.val) - 5) // Slightly above line
                .text(zone.label)
                .attr("fill", zone.color)
                .style("font-size", "11px")
                .style("font-weight", "bold")
                .style("text-anchor", "end"); // Right aligned text
        }
    });

    // ------------------------------------------------------------
    // 3B. Cadence Zones (X-Axis Reference)
    // ------------------------------------------------------------
    // Defines typical step frequencies (Steps Per Minute - SPM)
    const cadenceConfig = [
        { val: 100, label: "Moderate Walk (>100)", color: "#17becf" }, // Cyan-ish
        { val: 130, label: "Run / Jog (>130)", color: "#e377c2" }  // Pink-ish
    ];

    const cadenceGroup = svg.append("g").attr("class", "cadence-group").attr("opacity", 0);

    cadenceConfig.forEach(c => {
        if (c.val <= PHYSIO_LIMITS.MAX_STEPS_PER_MIN) {
            // Vertical Line
            cadenceGroup.append("line")
                .attr("x1", xScale(c.val)).attr("x2", xScale(c.val))
                .attr("y1", 0).attr("y2", height)
                .attr("stroke", c.color).attr("stroke-width", 2).attr("stroke-dasharray", "6, 4");

            // Label (Placed horizontally at top)
            cadenceGroup.append("text")
                .attr("x", xScale(c.val) + 5) // Slightly right of the line
                .attr("y", 15)                // Near top edge
                .text(c.label)
                .attr("fill", c.color)
                .style("font-size", "11px")
                .style("font-weight", "bold")
                .style("text-anchor", "start"); // Left aligned so it reads away from the line
        }
    });

    // ------------------------------------------------------------
    // Trendlines & Axes (Layer 3 - Overlay)
    // ------------------------------------------------------------
    const reg = calcLinearRegression(allData, "Steps", "HR");

    // A. Actual Data Trendline (Group for Line + Text)
    const trendGroup = svg.append("g")
        .attr("class", "trendline") 
        .attr("opacity", 0);

    trendGroup.append("line")
        .attr("x1", xScale(0)).attr("y1", yScale(reg.intercept))
        .attr("x2", xScale(PHYSIO_LIMITS.MAX_STEPS_PER_MIN))
        .attr("y2", yScale(reg.slope * PHYSIO_LIMITS.MAX_STEPS_PER_MIN + reg.intercept))
        .attr("stroke", "#06b6d4") 
        .attr("stroke-width", 2.5) 
        .style("filter", "drop-shadow(0 0 2px rgba(0,0,0,0.2))"); 

    trendGroup.append("text")
        .attr("x", xScale(PHYSIO_LIMITS.MAX_STEPS_PER_MIN) - 10)
        .attr("y", yScale(reg.slope * PHYSIO_LIMITS.MAX_STEPS_PER_MIN + reg.intercept) - 10)
        .text("My Data")
        .attr("fill", "#06b6d4")
        .style("font-weight", "bold")
        .style("font-size", "12px")
        .style("text-anchor", "end");

    // B. Benchmark Group
    const benchmarkGroup = svg.append("g").attr("class", "benchmark-group").attr("opacity", 0);

    // 1. Athletic (Emerald Green)
    const colorAthletic = "#10b981";
    const fitStart = 50, fitEnd = 130;
    benchmarkGroup.append("line")
        .attr("x1", xScale(0)).attr("y1", yScale(fitStart))
        .attr("x2", xScale(PHYSIO_LIMITS.MAX_STEPS_PER_MIN)).attr("y2", yScale(fitEnd))
        .attr("stroke", colorAthletic).attr("stroke-width", 2.5)
        .style("filter", "drop-shadow(0 0 2px rgba(0,0,0,0.2))");
    benchmarkGroup.append("text")
        .attr("x", xScale(PHYSIO_LIMITS.MAX_STEPS_PER_MIN) - 10).attr("y", yScale(fitEnd) - 10)
        .text("Athletic").attr("fill", colorAthletic)
        .style("font-weight", "bold").style("font-size", "12px").style("text-anchor", "end");

    // 2. Average (Warm Amber)
    const colorAverage = "#f59e0b";
    const avgStart = 70, avgEnd = 170;
    benchmarkGroup.append("line")
        .attr("x1", xScale(0)).attr("y1", yScale(avgStart))
        .attr("x2", xScale(PHYSIO_LIMITS.MAX_STEPS_PER_MIN)).attr("y2", yScale(avgEnd))
        .attr("stroke", colorAverage).attr("stroke-width", 2.5)
        .style("filter", "drop-shadow(0 0 2px rgba(0,0,0,0.2))");
    benchmarkGroup.append("text")
        .attr("x", xScale(PHYSIO_LIMITS.MAX_STEPS_PER_MIN) - 10).attr("y", yScale(avgEnd) - 5)
        .text("Average").attr("fill", colorAverage)
        .style("font-weight", "bold").style("font-size", "12px").style("text-anchor", "end");

    // 3. Unsporty (Soft Red)
    const colorUnsporty = "#ef4444";
    const unfitStart = 100, unfitEnd = 200;
    benchmarkGroup.append("line")
        .attr("x1", xScale(0)).attr("y1", yScale(unfitStart))
        .attr("x2", xScale(PHYSIO_LIMITS.MAX_STEPS_PER_MIN)).attr("y2", yScale(unfitEnd))
        .attr("stroke", colorUnsporty).attr("stroke-width", 2.5)
        .style("filter", "drop-shadow(0 0 2px rgba(0,0,0,0.2))");

    benchmarkGroup.append("text")
        .attr("x", xScale(PHYSIO_LIMITS.MAX_STEPS_PER_MIN) - 10)
        .attr("y", yScale(unfitEnd) - 5)
        .text("Unsporty").attr("fill", colorUnsporty)
        .style("font-weight", "bold").style("font-size", "12px").style("text-anchor", "end");
    // Axes
    svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(xScale));
    svg.append("text").attr("x", width / 2).attr("y", height + 40).style("text-anchor", "middle").text("Steps");
    svg.append("g").call(d3.axisLeft(yScale));
    svg.append("text").attr("transform", "rotate(-90)").attr("y", -45).attr("x", -height / 2).style("text-anchor", "middle").text("HR");

    // ------------------------------------------------------------
    // UI Control Panel (Optimized Compact Layout)
    // ------------------------------------------------------------
    const container = d3.select("#valueSelection");
    container.selectAll("*").remove();

    // Container Layout: Flexbox to put sections side-by-side
    container
        .style("display", "flex")
        .style("flex-wrap", "wrap")
        .style("gap", "15px") // Space between the groups
        .style("align-items", "flex-start")
        .style("padding", "5px 0");

    // Compact Button Style
    const btnStyle = `
        margin: 2px; 
        padding: 4px 8px; 
        cursor: pointer; 
        font-size: 11px; 
        border: 1px solid #999; 
        background-color: #f0f0f0; 
        border-radius: 3px;
        font-family: sans-serif;
    `;

    // Section & Header Styles (Compact)
    const sectionStyle = "display: flex; flex-direction: column; align-items: flex-start;";
    const headerStyle = "font-family: sans-serif; font-size: 10px; font-weight: bold; margin-bottom: 4px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #ccc; width: 100%; padding-bottom: 2px;";

    // Helper to create a section
    function createSection(title) {
        const wrapper = container.append("div").attr("style", sectionStyle);
        wrapper.append("div").text(title).attr("style", headerStyle);
        // Container for buttons within this section
        return wrapper.append("div").style("display", "flex").style("flex-wrap", "wrap");
    }

    // --- GROUP 1: DATA LAYERS (Heatmap & Points) ---
    const groupData = createSection("Korrelation");

    // 1. Heatmap
    groupData.append("button").text("Heatmap: TURN ON").attr("style", btnStyle)
        .on("click", function (e) {
            if (e) e.preventDefault(); isHeatmapVisible = !isHeatmapVisible;
            d3.selectAll(".heatmap-rect").transition().duration(600).attr("opacity", isHeatmapVisible ? 0.8 : 0)
                .on("end", function () { d3.select(this).style("pointer-events", isHeatmapVisible ? "all" : "none"); });
            d3.select(this).text(isHeatmapVisible ? "Heatmap: TURN OFF" : "Heatmap: TURN ON");
            d3.select(this).style("background-color", isHeatmapVisible ? "#d1e7dd" : "#f0f0f0"); // Visual Feedback
            if (window.showMaxCalories) window.dispatchEvent(new CustomEvent('dashboard-filter-changed', { detail: { filterType: 'maxCalories', isActive: true } }));
        });

    // 2. Points
    groupData.append("button").text("Points: TURN OFF").attr("style", btnStyle)
        .on("click", function (e) {
            if (e) e.preventDefault(); isPointsVisible = !isPointsVisible;
            d3.select("#points-group").transition().duration(600).attr("opacity", isPointsVisible ? 1 : 0)
                .on("end", function () { d3.select(this).style("pointer-events", isPointsVisible ? "all" : "none"); });
            d3.select(this).text(isPointsVisible ? "Points: TURN OFF" : "Points: TURN ON");
            d3.select(this).style("background-color", isPointsVisible ? "#d1e7dd" : "#f0f0f0");
            if (window.showMaxCalories) window.dispatchEvent(new CustomEvent('dashboard-filter-changed', { detail: { filterType: 'maxCalories', isActive: true } }));
        });

    // --- GROUP 2: GUIDES (Axes & Zones) ---
    const groupGuides = createSection("Referenzwerte");

    // 3. HR Zones
    groupGuides.append("button").text("HR Zones: TURN ON").attr("style", btnStyle)
        .on("click", function (e) {
            if (e) e.preventDefault(); isZonesVisible = !isZonesVisible;
            zonesGroup.transition().duration(600).attr("opacity", isZonesVisible ? 1 : 0);
            d3.select(this).text(isZonesVisible ? "HR Zones: TURN OFF" : "HR Zones: TURN ON");
            d3.select(this).style("background-color", isZonesVisible ? "#cfe2ff" : "#f0f0f0");
        });

    // 4. Cadence Zones
    groupGuides.append("button").text("Steps Zones: TURN ON").attr("style", btnStyle)
        .on("click", function (e) {
            if (e) e.preventDefault(); isCadenceVisible = !isCadenceVisible;
            cadenceGroup.transition().duration(600).attr("opacity", isCadenceVisible ? 1 : 0);
            d3.select(this).text(isCadenceVisible ? "Steps Zones: TURN OFF" : "Steps Zones: TURN ON");
            d3.select(this).style("background-color", isCadenceVisible ? "#cfe2ff" : "#f0f0f0");
        });

    // --- GROUP 3: ANALYSIS (Trends & Logic) ---
    const groupAnalysis = createSection("Analyse");

    // 5. Trendline
    groupAnalysis.append("button").text("Trendline: TURN ON").attr("style", btnStyle)
        .on("click", function (e) {
            if (e) e.preventDefault(); isTrendVisible = !isTrendVisible;
            d3.selectAll(".trendline").transition().duration(600).attr("opacity", isTrendVisible ? 1 : 0);
            d3.select(this).text(isTrendVisible ? "Trendline: TURN OFF" : "Trendline: TURN ON");
            d3.select(this).style("background-color", isTrendVisible ? "#fff3cd" : "#f0f0f0");
        });

    // 6. Benchmarks
    groupAnalysis.append("button").text("Benchmarks: TURN ON").attr("style", btnStyle)
        .on("click", function (e) {
            if (e) e.preventDefault(); isBenchmarksVisible = !isBenchmarksVisible;
            benchmarkGroup.transition().duration(600).attr("opacity", isBenchmarksVisible ? 1 : 0);
            d3.select(this).text(isBenchmarksVisible ? "Benchmarks: TURN OFF" : "Benchmarks: TURN ON");
            d3.select(this).style("background-color", isBenchmarksVisible ? "#fff3cd" : "#f0f0f0");
        });

    /**
     * Event Listener: dashboard-filter-changed
     * Listens for external signals (e.g. from a main dashboard) to highlight
     * maximum values in the currently visible charts.
     */
    window.addEventListener('dashboard-filter-changed', (event) => {
        const { filterType, isActive } = event.detail;

        if (filterType === 'maxCalories') {
            window.showMaxCalories = isActive;
        }

        if (!window.showMaxCalories) {
            clearHighlights();
            return;
        }

        updateHighlights();

        // --- Helper Functions for Highlighting ---
        function updateHighlights() {
            highlightMaxPoint();
            highlightMaxBin();
        }

        function clearHighlights() {
            d3.selectAll(".static-tooltip").remove();

            // Reset points
            d3.selectAll("circle")
                .attr("stroke", "white")
                .attr("stroke-width", 0.5)
                .attr("r", d => rScale(d.Calories));

            // Reset heatmap
            d3.selectAll(".heatmap-rect")
                .attr("stroke", "#eee")
                .attr("stroke-width", 0.5);
        }

        function highlightMaxPoint() {
            d3.selectAll(".static-tooltip-point").remove();

            if (typeof isPointsVisible !== 'undefined' && !isPointsVisible) {
                d3.selectAll("circle").attr("stroke", "white").attr("stroke-width", 0.5);
                return;
            }

            // Identify the point with the highest Calorie value
            const maxPoint = allData.reduce((max, current) =>
                (current.Calories > max.Calories) ? current : max
                , allData[0]);

            if (!maxPoint) return;

            // Highlight the specific DOM element
            const circleNode = d3.selectAll("circle")
                .filter(d => d === maxPoint)
                .attr("stroke", "red")
                .attr("stroke-width", 3)
                .attr("r", 10)
                .raise()
                .node();

            if (circleNode) {
                createStaticTooltip(circleNode, `
                <strong>MAXIMUM (Point)</strong><br>
                Steps: ${Math.round(maxPoint.Steps)}<br>
                HR: ${Math.round(maxPoint.HR)}<br>
                Cals: <b>${maxPoint.Calories}</b>
            `, "static-tooltip-point");
            }
        }

        function highlightMaxBin() {
            d3.selectAll(".static-tooltip-bin").remove();

            if (typeof isHeatmapVisible !== 'undefined' && !isHeatmapVisible) {
                d3.selectAll(".heatmap-rect").attr("stroke", "#eee").attr("stroke-width", 0.5);
                return;
            }

            // Identify the bin with the highest average value
            const maxBin = gridData.reduce((max, current) =>
                (current.val > max.val) ? current : max
                , gridData[0]);

            if (!maxBin) return;

            const rectSelection = d3.selectAll(".heatmap-rect")
                .filter(d => d === maxBin)
                .attr("stroke", "red")
                .attr("stroke-width", 3)
                .raise();

            const rectNode = rectSelection.node();

            if (rectNode) {
                createStaticTooltip(rectNode, `
                <strong>MAXIMUM (Area)</strong><br>
                Samples: ${maxBin.count}<br>
                Ø Cals: <b>${maxBin.val.toFixed(2)}</b>
            `, "static-tooltip-bin");
            }
        }

        function createStaticTooltip(domElement, htmlContent, extraClass) {
            const bounds = domElement.getBoundingClientRect();

            const absoluteX = window.scrollX + bounds.left + (bounds.width / 2);
            const absoluteY = window.scrollY + bounds.top + (bounds.height / 2);

            const offsetX = 10;
            const offsetY = -28;

            d3.select("body").append("div")
                .attr("class", `static-tooltip ${extraClass}`)
                .style("position", "absolute")
                .style("background", "rgba(0, 0, 0, 0.8)")
                .style("color", "#fff")
                .style("padding", "8px")
                .style("border-radius", "4px")
                .style("pointer-events", "none")
                .style("font-size", "12px")
                .style("z-index", "20")
                .html(htmlContent)
                .style("left", (absoluteX + offsetX) + "px")
                .style("top", (absoluteY + offsetY) + "px")
                .style("opacity", 0)
                .transition().duration(200).style("opacity", 0.9);
        }
    });
}).catch(err => console.error(err));

/**
 * Helper function to calculate simple linear regression.
 * @param {Array} data - Input dataset
 * @param {String} xKey - Key for x-axis property
 * @param {String} yKey - Key for y-axis property
 * @returns {Object} { slope, intercept }
 */
function calcLinearRegression(data, xKey, yKey) {
    let n = data.length;
    let sX = 0, sY = 0, sXY = 0, sXX = 0;

    data.forEach(v => {
        sX += v[xKey];
        sY += v[yKey];
        sXY += v[xKey] * v[yKey];
        sXX += v[xKey] * v[xKey];
    });

    let slope = (n * sXY - sX * sY) / (n * sXX - sX * sX);
    let intercept = (sY - slope * sX) / n;

    return { slope, intercept };
}
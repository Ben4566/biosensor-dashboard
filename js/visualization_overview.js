// =============================================================================
// Small Multiples with Interaction & Max-Calories Highlight
// =============================================================================

const svg = d3.select("#overview_chart");
const margin = { top: 30, right: 180, bottom: 50, left: 60 }; // Wider margin for legend

const width = parseInt(svg.style("width")) - margin.left - margin.right;
const totalHeight = parseInt(svg.style("height")) - margin.top - margin.bottom;

const categories = [
    { key: "HR", label: "Heart Rate (bpm)", color: "#d62728", type: "line" },
    { key: "Temperature", label: "Temperature (°F)", color: "#ff7f0e", type: "line" },
    { key: "Steps", label: "Steps", color: "#1f77b4", type: "area" },
    { key: "Calories", label: "Calories (kcal)", color: "#2ca02c", type: "line" }
];

const gap = 30;
const plotHeight = (totalHeight - (categories.length - 1) * gap) / categories.length;

const chartGroup = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

// Setup Legend Group
const legendGroup = svg.append("g")
    .attr("transform", `translate(${margin.left + width + 30}, ${margin.top})`);

const legendItems = {};
categories.forEach((cat, i) => {
    legendItems[cat.key] = legendGroup.append("text")
        .attr("y", i * (plotHeight + gap) + 20)
        .style("fill", cat.color)
        .style("font-size", "12px")
        .text(`${cat.label}: --`);
});

const dateLegend = legendGroup.append("text")
    .attr("y", totalHeight + 20)
    .style("font-weight", "bold")
    .text("Date: --");

d3.csv("/data/biosensors.csv").then(data => {

    // Data Processing
    data.forEach(d => {
        d.date = new Date(d.Time);
        categories.forEach(c => d[c.key] = +d[c.key]);
    });

    const aggregatedData = d3.rollups(data,
        v => ({
            date: v[0].date,
            HR: d3.mean(v, d => d.HR),
            Temperature: d3.mean(v, d => d.Temperature),
            Steps: d3.sum(v, d => d.Steps),
            Calories: d3.sum(v, d => d.Calories)
        }),
        d => d3.timeDay(d.date)
    ).map(([k, v]) => v).sort((a, b) => a.date - b.date);

    const xScale = d3.scaleTime().domain(d3.extent(aggregatedData, d => d.date)).range([0, width]);
    const bisectDate = d3.bisector(d => d.date).left;

    // Render Charts
    categories.forEach((cat, index) => {
        const plotGroup = chartGroup.append("g")
            .attr("class", `plot-${cat.key}`)
            .attr("transform", `translate(0, ${index * (plotHeight + gap)})`);

        const yMin = (cat.key === "Temperature" || cat.key === "HR")
            ? d3.min(aggregatedData, d => d[cat.key]) * 0.95 : 0;
        const yScale = d3.scaleLinear().domain([yMin, d3.max(aggregatedData, d => d[cat.key])]).range([plotHeight, 0]);

        // Draw Path
        let pathGen = (cat.type === "area")
            ? d3.area().x(d => xScale(d.date)).y0(plotHeight).y1(d => yScale(d[cat.key])).curve(d3.curveMonotoneX)
            : d3.line().x(d => xScale(d.date)).y(d => yScale(d[cat.key])).curve(d3.curveMonotoneX);

        plotGroup.append("path")
            .datum(aggregatedData)
            .attr("fill", cat.type === "area" ? cat.color : "none")
            .attr("stroke", cat.color)
            .attr("stroke-width", 1.5)
            .attr("fill-opacity", 0.3)
            .attr("d", pathGen);

        // Add Interactivity Marker
        const marker = plotGroup.append("g")
            .attr("class", "interaction-marker")
            .style("display", "none");

        marker.append("circle").attr("r", 4).attr("fill", cat.color).attr("stroke", "white");

        // Add Axes
        plotGroup.append("g").call(d3.axisLeft(yScale).ticks(5));
        if (index === categories.length - 1) {
            plotGroup.append("g").attr("transform", `translate(0, ${plotHeight})`).call(d3.axisBottom(xScale));
        }
    });

    // --- INTERACTION LOGIC ---

    const updateVisuals = (selectedData, isMaxHighlight = false) => {
        categories.forEach(cat => {
            const plot = chartGroup.select(`.plot-${cat.key}`);
            const yMin = (cat.key === "Temperature" || cat.key === "HR")
                ? d3.min(aggregatedData, d => d[cat.key]) * 0.95 : 0;
            const yScale = d3.scaleLinear().domain([yMin, d3.max(aggregatedData, d => d[cat.key])]).range([plotHeight, 0]);

            plot.select(".interaction-marker")
                .style("display", null)
                .attr("transform", `translate(${xScale(selectedData.date)}, ${yScale(selectedData[cat.key])})`)
                .select("circle")
                .attr("r", isMaxHighlight ? 6 : 4)
                .attr("stroke", isMaxHighlight ? "red" : "white")
                .attr("stroke-width", isMaxHighlight ? 2 : 1);

            legendItems[cat.key].text(`${cat.label}: ${selectedData[cat.key].toFixed(1)} ${isMaxHighlight ? " (MAX)" : ""}`);
        });
        dateLegend.text(`Date: ${d3.timeFormat("%b %d, %Y")(selectedData.date)}`);
    };

    const mouseOverlay = chartGroup.append("rect")
        .attr("width", width).attr("height", totalHeight).attr("fill", "none").attr("pointer-events", "all")
        .on("mousemove", function (event) {
            if (window.showMaxCalories) return; // Ignore mouse if Max Filter is active
            const x0 = xScale.invert(d3.pointer(event)[0]);
            const i = bisectDate(aggregatedData, x0, 1);
            const d = x0 - aggregatedData[i - 1].date > aggregatedData[i].date - x0 ? aggregatedData[i] : aggregatedData[i - 1];
            updateVisuals(d);
        })
 .on("click", function (event) {
    if (window.showMaxCalories) return;

    // ---------------------------------------------------------
    // 1. Temporal Resolution (X-Axis Lookup)
    // ---------------------------------------------------------
    
    // Convert DOM coordinates to data domain
    const [mouseX, mouseY] = d3.pointer(event);
    const x0 = xScale.invert(mouseX);
    
    // Bisect to find the insertion point for the inverted date
    const i = bisectDate(aggregatedData, x0, 1);
    
    // "Snap-to-nearest" logic: Determine if the cursor is closer 
    // to the preceding (left) or succeeding (right) data point.
    const d = x0 - aggregatedData[i - 1].date > aggregatedData[i].date - x0 
              ? aggregatedData[i] 
              : aggregatedData[i - 1];

    // ---------------------------------------------------------
    // 2. Data Preparation & Persistence
    // ---------------------------------------------------------

    // Create a deep copy of the date to prevent mutation of the reference dataset
    const targetDate = new Date(d.date);
    
    // Offset correction: Shift +1 day to align with target view's inclusive range/timezone handling
    targetDate.setDate(targetDate.getDate() + 1);
    
    // Serialize date to ISO format (YYYY-MM-DD) for sessionStorage transport
    const dateStr = targetDate.toISOString().split('T')[0];

    sessionStorage.setItem("selectedDate", dateStr);
    console.debug(`[Overview] Persisting date for transition: ${dateStr}`);

    // ---------------------------------------------------------
    // 3. Context Determination (Y-Axis / Drill-down)
    // ---------------------------------------------------------

    // Determine the specific chart lane (Small Multiple) based on cursor Y-position.
    // Logic relies on fixed row heights defined in global constants.
    const rowHeight = plotHeight + gap; 
    const clickedIndex = Math.floor(mouseY / rowHeight);

    // Boundary check to prevent array index out of bounds errors
    if (clickedIndex >= 0 && clickedIndex < categories.length) {
        // Extract the unique key (e.g., "HR", "Steps") for the target view.
        // COUPLING WARNING: This key must match 'name' properties in visualization_pattern.js
        const selectedCat = categories[clickedIndex].key; 
        
        sessionStorage.setItem("selectedCategory", selectedCat);
        console.debug(`[Overview] Auto-selecting category: ${selectedCat}`);
    }

    // ---------------------------------------------------------
    // 4. Navigation
    // ---------------------------------------------------------
    window.location.href = "pattern.html";
});

    // --- BUTTON EVENT LISTENER ---
    window.addEventListener('dashboard-filter-changed', (event) => {
        const { filterType, isActive } = event.detail;
        if (filterType === 'maxCalories') {
            window.showMaxCalories = isActive;
            if (isActive) {
                const maxDay = aggregatedData.reduce((max, curr) => curr.Calories > max.Calories ? curr : max, aggregatedData[0]);
                updateVisuals(maxDay, true);
            } else {
                d3.selectAll(".interaction-marker").style("display", "none");
                categories.forEach(cat => legendItems[cat.key].text(`${cat.label}: --`));
                dateLegend.text("Date: --");
            }
        }
    });


}).catch(err => console.error(err));
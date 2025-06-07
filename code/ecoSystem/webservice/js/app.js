const svg = d3.select('svg');
const container = svg.select('.zoom-group');
const tooltip = d3.select('#tooltip');
let simulation = null;
let maps = { degree: {}, out: {}, in: {}, meta: {}, myself: {} };
const zoom = d3.zoom()
    .scaleExtent([0.1, 5])
    .on('zoom', (event) => {
        container.attr('transform', event.transform);
    });
svg.call(zoom);
d3.json("../../docs/clean_results/jsons/10merged_json.json").then(data => {
    const years = [...new Set(data.map(d => d.Год))].sort((a, b) => a - b);
    d3.select('#yearFilter')
        .selectAll('option')
        .data(years)
        .enter()
        .append('option')
        .attr('value', d => d)
        .text(d => d);
    init(data);
}).catch(error => {
    console.error('Ошибка загрузки данных:', error);
    alert('Ошибка загрузки данных! Проверьте консоль для деталей.');
});
let originalData = null;
function init(data) {
    originalData = data;
    let selectedYears = [];
    function safeUpdate() {
        try {
            updateVisualization(selectedYears.length > 0 ? filterData(data, selectedYears) : originalData, selectedYears);
        } catch (error) {
            console.error("Ошибка при обновлении:", error);
            container.selectAll("*").remove();
            container.append("text")
                .attr("x", 100)
                .attr("y", 100)
                .text("Ошибка визуализации: " + error.message);
        }
    }
    d3.select('#resetFilter').on('click', function () {
        d3.select('#yearFilter').property('selectedIndex', -1);
        d3.select('#minLinks').property('value', '0');
        d3.select('#search').property('value', '');
        container.selectAll('.highlight').classed('highlight', false);
        container.selectAll('.dimmed').classed('dimmed', false);
        container.selectAll('.selected-link').classed('selected-link', false);
        updateVisualization(originalData, []);
        updateHighlight();
    });
    d3.select('#minLinks').on('input', safeUpdate);
    d3.select('#search').on('input', updateHighlight);
    d3.select('#yearFilter').on('change', function () {
        selectedYears = Array.from(this.selectedOptions, opt => +opt.value);
        safeUpdate();
    });
    const years = [...new Set(data.map(d => d.Год))].sort((a, b) => a - b);
    d3.select('#yearFilter')
        .selectAll('option')
        .data(years)
        .enter()
        .append('option')
        .attr('value', d => d)
        .text(d => d);
    safeUpdate();
}
let searchIndex = null;
let letterTexts = [];
function updateVisualization(dataToShow, selectedYears) {
    if (simulation) {
        simulation.stop();
        simulation.nodes([]);
        simulation.force('link').links([]);
        simulation = null;
    }
    container.selectAll('*').remove();
    resetMaps(maps);
    calculateMetrics(dataToShow, maps);
    let { links, nodes } = processData(dataToShow, maps);
    const minLinks = +d3.select('#minLinks').property('value') || 0;
    nodes = nodes.filter(node =>
        (maps.degree[node.id] || 0) >= minLinks
    );
    if (nodes.length === 0) {
        container.append("text")
            .attr("x", 100)
            .attr("y", 100)
            .text("Нет данных для отображения");
        return;
    }
    const remainingNodes = new Set(nodes.map(n => n.id));
    const validLinks = links.filter(l =>
        remainingNodes.has(l.source) &&
        (l.isLoop || remainingNodes.has(l.target))
    );
    if (nodes.length > 0 && validLinks.length >= 0) {
        simulation = createSimulation(nodes, validLinks, maps);
        drawElements(validLinks, nodes, simulation);
    }
}
function resetMaps(maps) {
    Object.keys(maps.degree).forEach(k => delete maps.degree[k]);
    Object.keys(maps.out).forEach(k => delete maps.out[k]);
    Object.keys(maps.in).forEach(k => delete maps.in[k]);
    Object.keys(maps.myself).forEach(k => delete maps.myself[k]);
    Object.keys(maps.meta).forEach(k => delete maps.meta[k]);
}
function filterData(data, selectedYears) {
    return selectedYears.length > 0
        ? data.filter(d => selectedYears.includes(d.Год))
        : data;
}
function calculateMetrics(data, maps) {
    data.forEach(d => {
        const senders = Array.isArray(d.Отправитель) ? d.Отправитель : [d.Отправитель];
        const receivers = Array.isArray(d.Получатель)
            ? d.Получатель
            : (d.Получатель ? [d.Получатель] : []);
        // Обновление метаданных для всех отправителей
        senders.forEach(sender => {
            if (!maps.meta[sender]) maps.meta[sender] = {
                numbers: new Set(),
                texts: {},
                titles: {},
                fullData: {}
            };
            maps.meta[sender].numbers.add(d.Номер_в_издании);
            maps.meta[sender].texts[d.Номер_в_издании] = d.Текст;
            maps.meta[sender].titles[d.Номер_в_издании] = d.Название;
            maps.meta[sender].fullData[d.Номер_в_издании] = d;
            maps.out[sender] = (maps.out[sender] || 0) + 1;
            maps.degree[sender] = (maps.degree[sender] || 0) + 1;
        });
        // Обработка получателей
        if (receivers.length === 0) {
            senders.forEach(sender => {
                maps.myself[sender] = (maps.myself[sender] || 0) + 1;
            });
        } else {
            receivers.forEach(receiver => {
                if (!maps.meta[receiver]) maps.meta[receiver] = {
                    numbers: new Set(),
                    texts: {},
                    titles: {},
                    fullData: {}
                };
                maps.meta[receiver].numbers.add(d.Номер_в_издании);
                maps.meta[receiver].texts[d.Номер_в_издании] = d.Текст;
                maps.meta[receiver].titles[d.Номер_в_издании] = d.Название;
                maps.meta[receiver].fullData[d.Номер_в_издании] = d;
                maps.in[receiver] = (maps.in[receiver] || 0) + senders.length;
                maps.degree[receiver] = (maps.degree[receiver] || 0) + senders.length;
            });
        }
    });
}
function processData(data, maps) {
    const links = [];
    const linkCounts = {};
    const nodeSet = new Set();
    data.forEach(d => {
        const senders = Array.isArray(d.Отправитель) ? d.Отправитель : [d.Отправитель];
        const receivers = Array.isArray(d.Получатель)
            ? d.Получатель
            : (d.Получатель ? [d.Получатель] : []);
        // Добавление узлов для всех отправителей
        senders.forEach(sender => nodeSet.add(sender));
        // Обработка петель (отправитель = получатель)
        if (receivers.length === 0 ||
            (receivers.length === 1 && senders.includes(receivers[0]))) {
            senders.forEach(sender => {
                const key = `${sender}→${sender}`;
                if (!linkCounts[key]) linkCounts[key] = { count: 0, numbers: [] };
                linkCounts[key].count++;
                linkCounts[key].numbers.push(d.Номер_в_издании);
                links.push({
                    source: sender,
                    target: sender,
                    isLoop: true,
                    count: linkCounts[key].count,
                    numbers: [...new Set(linkCounts[key].numbers)],
                    countAtoB: linkCounts[key].count,
                    countBtoA: 0
                });
            });
        } else {
            // Добавление узлов для всех получателей
            receivers.forEach(receiver => nodeSet.add(receiver));
            // Генерация всех возможных пар (отправитель → получатель)
            senders.forEach(sender => {
                receivers.forEach(receiver => {
                    const key = `${sender}→${receiver}`;
                    const reverseKey = `${receiver}→${sender}`;
                    if (!linkCounts[key]) linkCounts[key] = { count: 0, numbers: [] };
                    if (!linkCounts[reverseKey]) linkCounts[reverseKey] = { count: 0, numbers: [] };
                    linkCounts[key].count++;
                    linkCounts[key].numbers.push(d.Номер_в_издании);
                    const isBidirectional = linkCounts[reverseKey].count > 0;
                    const existingLink = links.find(l =>
                        (l.source === sender && l.target === receiver) ||
                        (l.source === receiver && l.target === sender)
                    );
                    if (existingLink) {
                        if (existingLink.source === sender) {
                            existingLink.countAtoB = linkCounts[key].count;
                        } else {
                            existingLink.countBtoA = linkCounts[key].count;
                        }
                        existingLink.count = existingLink.countAtoB + existingLink.countBtoA;
                        existingLink.bidirectional = isBidirectional;
                        existingLink.numbers = [...new Set([...existingLink.numbers, d.Номер_в_издании])];
                    } else {
                        links.push({
                            source: sender,
                            target: receiver,
                            isLoop: false,
                            count: 1,
                            numbers: [d.Номер_в_издании],
                            countAtoB: 1,
                            countBtoA: 0,
                            bidirectional: false
                        });
                    }
                });
            });
        }
    });
    const nodes = Array.from(nodeSet).map(id => ({ id }));
    return { nodes, links };
}
function createSimulation(nodes, links, maps) {
    if (!nodes || !links || nodes.length === 0) {
        console.error("Некорректные данные:", { nodes, links });
        return null;
    }
    const filteredDegree = {};
    nodes.forEach(node => {
        filteredDegree[node.id] = maps.degree[node.id];
    });
    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(Object.values(filteredDegree))])
        .range([8, 50]);
    const nodeCount = nodes.length;
    let distance, strength, chargeStrength, collideRadiusPadding;
    if (nodeCount < 50) {
        distance = 500;
        strength = 0.2;
        chargeStrength = -300;
        collideRadiusPadding = 30;
    } else if (nodeCount < 200) {
        distance = 500;
        strength = 0.1;
        chargeStrength = -450;
        collideRadiusPadding = 40;
    } else {
        distance = 600;
        strength = 0.9;
        chargeStrength = -2000;
        collideRadiusPadding = 70;
    }
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links)
            .id(d => d.id)
            .distance(distance)
            .strength(strength))
        .force('charge', d3.forceManyBody()
            .strength(chargeStrength)
            .distanceMax(distance * 1.5))
        .force('collide', d3.forceCollide()
            .radius(d => radiusScale(filteredDegree[d.id]) + collideRadiusPadding)
            .strength(0.8))
        .force('center', d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2))
        .force('x', d3.forceX().strength(0.05))
        .force('y', d3.forceY().strength(0.05))
        .alphaDecay(0.003)
        .velocityDecay(0.9)
        .alphaMin(0.001);
    simulation.restart();
    return simulation;
}
function drawElements(validLinks, filteredNodes, simulation) {
    const regularLinks = validLinks.filter(d => !d.isLoop);
    const loopLinks = validLinks.filter(d => d.isLoop);
    const linkGroup = container.append('g').attr('class', 'links');
    const linkPaths = linkGroup.selectAll('.link.regular')
        .data(regularLinks)
        .enter().append('path')
        .attr('class', d => `link regular ${d.isCollective ? 'collective-link' : ''}`)
        .attr('stroke', d => d.bidirectional ? '#2abd28' : '#ffa600')
        .attr('stroke-width', 1.5)
        .attr('fill', 'none')
        .attr('marker-end', d => `url(#${d.bidirectional ? 'arrow-bid' : 'arrow'})`)
        .on('mouseover', function (event, d) {
            if (d.bidirectional) {
                tooltip.style('opacity', 1)
                    .html(`<strong>Количество писем:</strong><br>
                             Всего: <strong>${d.count}</strong><br>
                                    ${d.source.id} → ${d.target.id}: <strong>${d.countAtoB}</strong><br>
                                    ${d.target.id} → ${d.source.id}: <strong>${d.countBtoA}</strong><br>
                                   `);
            } else {
                tooltip.style('opacity', 1)
                    .html(`<strong>${d.source.id} → ${d.target.id}</strong><br>Количество писем: <strong>${d.count}</strong>`);
            }
        })
        .on('mousemove', updateTooltipPosition)
        .on('mouseout', function () {
            if (!d3.select(this).classed('fixed')) {
                tooltip.style('opacity', 0);
            }
        })
        .on('click', function (event, d) {
            event.stopPropagation();
            const link = d3.select(this);
            const isFixed = link.classed('fixed');
            container.selectAll('.link.fixed').classed('fixed', false);
            if (!isFixed) {
                link.classed('fixed', true);
                tooltip.style('opacity', 1);
                const sourceNode = d.source.id;
                const targetNode = d.target.id;
                container.selectAll('.highlight').classed('highlight', false);
                container.selectAll('.dimmed').classed('dimmed', false);
                container.selectAll('.node-group')
                    .filter(n => n.id === sourceNode || n.id === targetNode)
                    .classed('highlight', true);
                container.selectAll('.node-group')
                    .filter(n => n.id !== sourceNode && n.id !== targetNode)
                    .classed('dimmed', true);
                container.selectAll('.link')
                    .filter(l => l.source.id !== sourceNode || l.target.id !== targetNode)
                    .classed('dimmed', true);
                showLinkPopup(d, sourceNode, targetNode);
            } else {
                tooltip.style('opacity', 0);
                container.selectAll('.highlight').classed('highlight', false);
                container.selectAll('.dimmed').classed('dimmed', false);
            }
        });
    const loopGroup = container.append('g').attr('class', 'loops');
    const loopPaths = loopGroup.selectAll('.link.loop')
        .data(loopLinks)
        .enter().append('path')
        .attr('class', 'link loop')
        .attr('stroke', '#cf5ff5')
        .attr('stroke-width', 2)
        .attr('fill', 'none')
        .attr('marker-end', 'url(#loop-arrow)')
        .on('mouseover', function (event, d) {
            tooltip.style('opacity', 1)
                .html(`<strong>${d.source.id} → ${d.source.id}</strong><br>Писем: ${d.count}`);
        })
        .on('mousemove', updateTooltipPosition)
        .on('mouseout', function () {
            tooltip.style('opacity', 0);
        });
    const nodeG = container.append('g').attr('class', 'nodes')
        .selectAll('.node-group')
        .data(filteredNodes)
        .enter().append('g')
        .attr('class', 'node-group')
        .call(d3.drag()
            .on('start', dragStarted)
            .on('drag', dragged)
            .on('end', dragEnded));
    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(Object.values(maps.degree))])
        .range([10, 70]);
    nodeG.append('circle')
        .attr('class', 'node-circle')
        .attr('r', d => radiusScale(maps.degree[d.id]))
        .attr('fill', d => d.id.match(/[«»]/) ? '#fffb05' : '#00027a');
    nodeG.append('text')
        .attr('class', 'node-text')
        .attr('y', d => radiusScale(maps.degree[d.id]) + 30)
        .text(d => d.id);
    simulation.on('tick', () => {
        linkPaths.attr('d', d => {
            const dx = d.target.x - d.source.x;
            const dy = d.target.y - d.source.y;
            const dr = Math.sqrt(dx * dx + dy * dy);
            const targetRadius = radiusScale(maps.degree[d.target.id]);
            const ratio = (dr - targetRadius) / dr;
            const tx = d.source.x + dx * ratio;
            const ty = d.source.y + dy * ratio;
            return `M${d.source.x},${d.source.y}L${tx},${ty}`;
        });
        loopPaths.attr('d', d => {
            const r = radiusScale(maps.degree[d.source.id]) + 20;
            return `M${d.source.x},${d.source.y - r}
                      A${r} ${r} 0 1 1 ${d.source.x},${d.source.y + r}
                      A${r} ${r} 0 1 1 ${d.source.x},${d.source.y - r}`;
        });
        nodeG.attr('transform', d => `translate(${d.x},${d.y})`);
    });
    nodeG.on('click', function (event, d) {
        event.stopPropagation();
        const isActive = d3.select(this).classed('highlight');
        container.selectAll('.highlight').classed('highlight', false);
        container.selectAll('.dimmed').classed('dimmed', false);
        container.selectAll('.selected-link').classed('selected-link', false);
        container.selectAll('.link-count').remove();
        if (!isActive) {
            d3.select(event.currentTarget).classed('highlight', true);
            const connectedNodes = new Set([d.id]);
            container.selectAll('.link')
                .filter(l => l.source.id === d.id || l.target.id === d.id)
                .each(function (l) {
                    connectedNodes.add(l.source.id);
                    connectedNodes.add(l.target.id);
                    d3.select(this).classed('selected-link', true);
                });
            container.selectAll('.node-group')
                .classed('dimmed', node => !connectedNodes.has(node.id));
            container.selectAll('.link')
                .classed('dimmed', link =>
                    link.source.id !== d.id && link.target.id !== d.id
                );
            showNodePopup(d);
        }
    });
    nodeG.on('mouseover', showTooltip)
        .on('mousemove', updateTooltipPosition)
        .on('mouseout', hideTooltip);
    svg.on('click', () => {
        container.selectAll('.highlight').classed('highlight', false);
        container.selectAll('.dimmed').classed('dimmed', false);
        container.selectAll('.selected-link').classed('selected-link', false);
        container.selectAll('.link-count').remove();
        closePopup();
        container.selectAll('.link.fixed').classed('fixed', false);
        tooltip.style('opacity', 0);
    });
}
function showNodePopup(nodeData) {
    const popup = d3.select('#nodePopup');
    const metaData = maps.meta[nodeData.id];
    let metaText = 'нет данных';
    let textsHtml = '';
    if (metaData && metaData.numbers && metaData.numbers.size > 0) {
        metaText = Array.from(metaData.numbers).join(', ');
        textsHtml = `
            <div style="margin-top: 15px;">
                <strong>Письма:</strong>
                <div style="max-height: 200px; overflow-y: auto; margin-top: 5px;">
                    <ul style="list-style-type: none; padding-left: 0; margin: 0;">
                        ${Array.from(metaData.numbers).sort((a, b) => a - b).map(num => {
            const title = metaData.titles[num] || 'Без названия';
            return `
                            <li style="margin-bottom: 5px; border-bottom: 1px solid #eee; padding-bottom: 5px;">
                                <a href="#" class="letter-link" data-num="${num}" 
                                   style="color: #0066cc; text-decoration: none; display: block;"
                                   onmouseover="this.style.textDecoration='underline'" 
                                   onmouseout="this.style.textDecoration='none'">
                                    №${num}. ${title}
                                </a>
                            </li>
                        `;
        }).join('')}
                    </ul>
                </div>
            </div>
        `;
    }
    popup.select('#popupTitle').text(nodeData.id);
    popup.select('#popupContent').html(`
        <p><strong>Всего:</strong> ${maps.degree[nodeData.id] || 0}</p>
        <p><strong>Исходящих:</strong> ${maps.out[nodeData.id] || 0}</p>
        <p><strong>Входящих:</strong> ${maps.in[nodeData.id] || 0}</p>
        <p><strong>Без получателя:</strong> ${maps.myself[nodeData.id] || 0}</p>
        <p><strong>Номера в издании:</strong> ${metaText}</p>
        ${textsHtml}
    `);
    popup.selectAll('.letter-link').on('click', function (event) {
        event.preventDefault();
        const num = d3.select(this).attr('data-num');
        const letterData = metaData.fullData[num];
        if (letterData) {
            showLetterModal(letterData);
        } else {
            console.error('Данные письма не найдены:', num);
            alert('Ошибка загрузки данных письма');
        }
    });
    popup.classed('show', true);
}
function closePopup() {
    d3.select('#nodePopup').classed('show', false);
}
function showTooltip(event, d) {
    const metaData = maps.meta[d.id];
    let metaText = 'нет данных';
    if (metaData && metaData.numbers && metaData.numbers.size > 0) {
        metaText = Array.from(metaData.numbers).join(', ');
    }
    tooltip.style('opacity', 1).html(`
        <strong>${d.id}</strong><br>
        Всего писем: ${maps.degree[d.id] || 0}<br>
        Отправлено: ${maps.out[d.id] || 0}<br>
        Получено: ${maps.in[d.id] || 0}<br>
        Без получателя: ${maps.myself[d.id] || 0}
    `);
}
function showLinkPopup(linkData, sourceNode, targetNode) {
    const popup = d3.select('#nodePopup');
    let textsHtml = '<div style="margin-top: 15px;"><strong>Письма:</strong></div>';
    const fromSource = [];
    const fromTarget = [];
    if (linkData.numbers && linkData.numbers.length > 0) {
        linkData.numbers.forEach(num => {
            const letterData = originalData.find(d => d.Номер_в_издании == num);
            if (!letterData) return;
            if (letterData.Отправитель === sourceNode && letterData.Получатель === targetNode) {
                fromSource.push({ num, title: letterData.Название || 'Без названия' });
            } else if (letterData.Отправитель === targetNode && letterData.Получатель === sourceNode) {
                fromTarget.push({ num, title: letterData.Название || 'Без названия' });
            }
        });
        fromSource.sort((a, b) => a.num - b.num);
        fromTarget.sort((a, b) => a.num - b.num);
        if (fromSource.length > 0) {
            textsHtml += `
                <div style="margin-top: 10px;">
                    <strong>Отправитель ${sourceNode} <br>Получатель ${targetNode}:</strong>
                    <div class="scrollable-list">
                        <ul style="list-style-type: none; padding-left: 0; margin: 5px 0;">
                            ${fromSource.map(item => `
                                <li style="margin-bottom: 5px; border-bottom: 1px solid #eee; padding-bottom: 5px;">
                                    <a href="#" class="letter-link" data-num="${item.num}" 
                                       style="color: #0066cc; text-decoration: none; display: block;"
                                       onmouseover="this.style.textDecoration='underline'" 
                                       onmouseout="this.style.textDecoration='none'">
                                        №${item.num}. ${item.title}
                                    </a>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>`;
        }
        if (fromTarget.length > 0) {
            textsHtml += `
                <div style="margin-top: 10px;">
                    <strong>Отправитель ${targetNode}  <br>Получатель ${sourceNode}:</strong>
                    <div class="scrollable-list">
                        <ul style="list-style-type: none; padding-left: 0; margin: 5px 0;">
                            ${fromTarget.map(item => `
                                <li style="margin-bottom: 5px; border-bottom: 1px solid #eee; padding-bottom: 5px;">
                                    <a href="#" class="letter-link" data-num="${item.num}" 
                                       style="color: #0066cc; text-decoration: none; display: block;"
                                       onmouseover="this.style.textDecoration='underline'" 
                                       onmouseout="this.style.textDecoration='none'">
                                        №${item.num}. ${item.title}
                                    </a>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>`;
        }
    } else {
        textsHtml += '<div style="margin-top: 10px;">Нет данных</div>';
    }
    popup.select('#popupTitle').text(`Связь: ${sourceNode} → ${targetNode}`);
    popup.select('#popupContent').html(`
        <p><strong>Количество писем:</strong> ${linkData.count}</p>
        ${textsHtml}
    `);
    popup.selectAll('.letter-link').on('click', function (event) {
        event.preventDefault();
        const num = d3.select(this).attr('data-num');
        const letterData = originalData.find(d => d.Номер_в_издании == num);
        if (letterData) {
            showLetterModal(letterData);
        } else {
            console.error('Данные письма не найдены:', num);
            alert('Ошибка загрузки данных письма');
        }
    });
    popup.classed('show', true);
}
function updateTooltipPosition(event) {
    tooltip.style('left', `${event.pageX + 10}px`).style('top', `${event.pageY + 10}px`);
}
function hideTooltip() {
    tooltip.style('opacity', 0);
}
function updateHighlight() {
    const term = d3.select('#search').property('value').toLowerCase();
    container.selectAll('.link-count').remove();
    container.selectAll('.node-group').classed('highlight', false);
    container.selectAll('.node-group').classed('dimmed', false);
    container.selectAll('.link').classed('dimmed', false);
    container.selectAll('.selected-link').classed('selected-link', false);
    if (!term) return;
    const matchingNodes = new Set();
    container.selectAll('.node-group').each(function (d) {
        if (d.id.toLowerCase().includes(term)) {
            matchingNodes.add(d.id);
        }
    });
    const connectedNodes = new Set(matchingNodes);
    const connectedLinks = new Set();
    container.selectAll('.link').each(function (l) {
        const sourceMatch = matchingNodes.has(l.source.id);
        const targetMatch = matchingNodes.has(l.target.id);
        if (sourceMatch || targetMatch) {
            connectedLinks.add(l);
            if (!sourceMatch) connectedNodes.add(l.source.id);
            if (!targetMatch) connectedNodes.add(l.target.id);
        }
    });
    container.selectAll('.node-group').classed('highlight', d => connectedNodes.has(d.id));
    container.selectAll('.node-group').classed('dimmed', d => !connectedNodes.has(d.id));
    container.selectAll('.link').classed('dimmed', l => {
        return !(connectedNodes.has(l.source.id) && connectedNodes.has(l.target.id));
    });
    container.selectAll('.link').classed('selected-link', l => {
        return matchingNodes.has(l.source.id) || matchingNodes.has(l.target.id);
    });
}
function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.001).restart();
    d.fx = d.x;
    d.fy = d.y;
}
function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}
function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0.01);
    d.fx = null;
    d.fy = null;
}
function showLetterModal(data) {
    if (!data) {
        console.error('Нет данных для отображения');
        return;
    }
    const safeData = {
        number: data.Номер_в_издании ?? 'Нет номера',
        title: data.Название?.trim() || 'Без названия',
        text: (data.Текст?.replace(/<<\d+>>/g, '') || 'Текст письма отсутствует').replace(/\n/g, '<br>'),
        sender: data.Отправитель || 'Неизвестный отправитель',
        receiver: data.Получатель || 'Неизвестный получатель',
        date: data.Дата || 'Дата не указана',
        location: data.Локация || 'Локация не указана',
        year: data.Год || 'Год не указан',
        source: (data.Источник?.replace(/\r/g, '<br>') || 'Источник отсутствует')
    };
    const titleElement = document.getElementById('letterModalTitle');
    const textElement = document.getElementById('letterModalText');
    const metaElement = document.getElementById('letterMetaContent');
    titleElement.innerHTML = `Письмо №${safeData.number}<br><small>${safeData.title}</small>`;
    textElement.innerHTML = safeData.text;
    metaElement.innerHTML = `
        <div class="letter-meta-item">
            <div class="letter-meta-label">От:</div>
            <div class="letter-meta-value">${safeData.sender}</div>
        </div>
        <div class="letter-meta-item">
            <div class="letter-meta-label">Кому:</div>
            <div class="letter-meta-value">${safeData.receiver}</div>
        </div>
        <div class="letter-meta-item">
            <div class="letter-meta-label">Дата:</div>
            <div class="letter-meta-value">${safeData.date}</div>
        </div>
        <div class="letter-meta-item">
            <div class="letter-meta-label">Место:</div>
            <div class="letter-meta-value">${safeData.location}</div>
        </div>
        <div class="letter-meta-item">
            <div class="letter-meta-label">Год:</div>
            <div class="letter-meta-value">${safeData.year}</div>
        </div>
        <div class="letter-meta-item">
            <div class="letter-meta-label">Источник:</div>
            <div class="letter-meta-value">${safeData.source}</div>
        </div>`;
    document.getElementById('letterModal').classList.add('show');
}
window.handleSearchResultClick = function (resultData) {
    showLetterModal(resultData);
};
function closeLetterModal() {
    document.getElementById('letterModal').classList.remove('show');
}
let searchTimeout;
const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};
function parseSearchQuery(query) {
    const exactPhraseMatch = query.match(/"(.*?)"/);
    const exactPhrase = exactPhraseMatch ? exactPhraseMatch[1] : null;
    const wordsQuery = exactPhrase ? query.replace(`"${exactPhrase}"`, '').trim() : query;
    const words = wordsQuery.split(/\s+/).filter(word => word.length > 0);
    return {
        exactPhrase,
        words
    };
}
function combineResults(exactResults, wordResults) {
    const resultMap = new Map();
    exactResults.forEach(result => {
        resultMap.set(result.Номер_в_издании, {
            ...result,
            isExactMatch: true,
            score: result.score * 1.5
        });
    });
    wordResults.forEach(result => {
        if (!resultMap.has(result.Номер_в_издании)) {
            resultMap.set(result.Номер_в_издании, {
                ...result,
                isExactMatch: false
            });
        }
    });
    return Array.from(resultMap.values()).sort((a, b) => b.score - a.score);
}
function displaySearchResults(results, query, container) {
    let html = '';
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 0);
    results.forEach(result => {
        const safeResult = {
            ...result,
            Текст: result.Текст?.replace(/</g, '<').replace(/>/g, '>') || '',
            excerpt: result.excerpt?.replace(/</g, '<').replace(/>/g, '>') || ''
        };
        const exactMatchBadge = result.isExactMatch
            ? '<span class="exact-badge" title="Точное совпадение">✓</span>'
            : '';
        html += `
            <div class="search-result" 
                 onclick="handleSearchResultClick(${JSON.stringify(safeResult)
                .replace(/"/g, '&quot;')
                .replace(/</g, '\\u003c')
                .replace(/>/g, '\\u003e')})">
                <h4>№${result.Номер_в_издании} · ${result.Название}</h4>
                <div class="meta">
                    <span class="sender">${result.Отправитель}</span> → 
                    <span class="receiver">${result.Получатель}</span>
                </div>
                ${result.excerpt ? `<div class="excerpt">${highlightTerms(result.excerpt, queryTerms)}</div>` : ''}
            </div>
        `;
    });
    container.innerHTML = html;
}
function highlightTerms(text, terms, exactPhrase) {
    let highlighted = text;
    if (exactPhrase) {
        const escapedPhrase = exactPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const phraseRegex = new RegExp(`(${escapedPhrase})`, 'gi');
        highlighted = highlighted.replace(phraseRegex, '<span class="highlight">$1</span>');
    }
    terms.forEach(term => {
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordRegex = new RegExp(`\\b(${escapedTerm})\\b`, 'gi');
        highlighted = highlighted.replace(wordRegex, '<span class="highlight">$1</span>');
    });
    return highlighted;
}
document.getElementById('fullTextSearch').addEventListener('input', async function (e) {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    const resultsContainer = document.getElementById('searchResultsContainer');
    if (query.length < 2) {
        resultsContainer.innerHTML = '<div class="info-message">Введите минимум 2 символа</div>';
        return;
    }
    resultsContainer.innerHTML = `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>Поиск...</p>
        </div>
    `;
    searchTimeout = setTimeout(async () => {
        try {
            const searchTerms = parseSearchQuery(query);
            let exactResults = [];
            if (searchTerms.exactPhrase) {
                const exactResponse = await fetch(`http://localhost:5001/api/search?q=${encodeURIComponent(searchTerms.exactPhrase)}&exact=true`);
                if (exactResponse.ok) {
                    exactResults = await exactResponse.json();
                }
            }
            let wordResults = [];
            if (searchTerms.words.length > 0) {
                const wordResponse = await fetch(`http://localhost:5001/api/search?q=${encodeURIComponent(searchTerms.words.join(' '))}`);
                if (wordResponse.ok) {
                    wordResults = await wordResponse.json();
                }
            }
            const combinedResults = combineResults(exactResults, wordResults);
            if (!combinedResults.length) {
                resultsContainer.innerHTML = '<div class="info-message">Ничего не найдено</div>';
                return;
            }
            displaySearchResults(combinedResults, query, resultsContainer);
        } catch (error) {
            console.error('Ошибка поиска:', error);
            resultsContainer.innerHTML = `
                <div class="error-message">
                    <p>Ошибка соединения</p>
                    <p class="error-details">${error.message}</p>
                </div>
            `;
        }
    }, 1000);
});
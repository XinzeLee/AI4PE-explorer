export const categories = [
  { id: 'semiconductor', name: 'Semiconductors', color: '#53616b' },
  { id: 'capacitor', name: 'Capacitors', color: '#3778c5' },
  { id: 'magnetic', name: 'Magnetics', color: '#e58338' },
  { id: 'driver', name: 'Gate drivers', color: '#88c7aa' },
  { id: 'control', name: 'Control card', color: '#118e87' },
  { id: 'thermal', name: 'Thermal', color: '#959d9f' },
  { id: 'emi', name: 'EMI filter', color: '#e5bf4b' },
  { id: 'structure', name: 'Structure', color: '#b1b7b5' },
];
const part = (id, category, name, position, explode, description, role, material, type, extra = {}) => ({ id, category, name, position, explode, description, role, material, type, ...extra });
export const components = [
  part('T1','magnetic','High-frequency transformer',[-.15,.64,-.1],[0,3.1,0],'Transfers energy between the two bridges across a galvanic isolation barrier. The ferrite core guides magnetic flux; the copper windings couple the high- and low-voltage sides.','Galvanic isolation','Ferrite + copper','transformer'),
  part('L1','magnetic','Transfer inductor',[-2.55,.65,-.15],[-2,2.4,-.3],'Stores energy in the AC link. Together with transformer leakage inductance, it sets the current slope and enables phase-shift-controlled power transfer.','AC-link energy storage','Ferrite + copper','inductor'),
  ...Array.from({length:8},(_,i)=>part(`Q${i+1}`,'semiconductor',`${i<4?'HV SiC':'LV silicon'} MOSFET ${i%4+1}`,[-4.15+i*1.18,.62,2.55],[(i-3.5)*.35,1.4+(i%2)*.5,2.3],i<4?'One of four SiC MOSFETs forming the high-voltage full bridge. Switching the bridge converts DC into a high-frequency square wave.':'One of four silicon MOSFETs forming the low-voltage active bridge. Synchronous switching supports power flow in either direction.',i<4?'High-voltage bridge':'Low-voltage bridge',i<4?'Silicon carbide':'Silicon','mosfet',{side:i<4?'HV':'LV'})),
  ...Array.from({length:6},(_,i)=>part(`C${i+1}`,'capacitor',`${i<2?'HV DC-link':'LV DC-link'} capacitor ${i<2?i+1:i-1}`,i<2?[-3.45+i*1.32,.64,-1.95]:[2.5+((i-2)%2)*1.25,.64,-1.5+Math.floor((i-2)/2)*1.45],[(i<2?-1:1)*(1.1+(i%2)*.4),1.8+(i%2)*.65,i<2?-1.4:-.4], 'Buffers energy on the DC bus and reduces switching-frequency voltage ripple. The two buses use capacitors suited to their own voltage and ripple-current demands.','DC-bus energy buffer','Aluminum electrolytic','capacitor',{tall:i<2})),
  ...Array.from({length:4},(_,i)=>part(`GD${i+1}`,'driver',`Gate driver board ${i+1}`,[[-3.9,-2.4,2.4,3.9][i],.88,1.1],[(i<2?-1:1)*1.1,3.6,1.2],'A dual-channel gate driver daughterboard supplies fast gate-charge pulses to one bridge leg. Its isolated control interface separates the controller from the switching nodes.','Two gate-drive channels','FR-4 + driver ICs','driver')),
  part('CTRL1','control','Digital control card',[-.25,.7,-2.85],[0,4.1,-1.6],'Coordinates the two bridges by adjusting their phase shift. Voltage, current and temperature feedback support regulation and protection.','PWM + feedback control','FR-4 + digital controller','control'),
  part('HS1','thermal','Finned aluminum heatsink',[0,-.34,0],[0,-1.1,0],'Conducts heat away from power devices through the baseplate. Closely spaced fins increase the surface area exposed to cooling air. Thermal interfaces are represented conceptually.','Heat spreading + cooling','Anodized aluminum','heatsink'),
  part('EMI1','emi','EMI filter board',[-4.85,.59,-.4],[-3.1,.7,-.5],'Supports the common-mode choke and film capacitors at the input. Their placement near the connector helps keep high-frequency noise from returning along the DC cables.','Input noise suppression','FR-4','emiBoard'),
  part('LCM1','emi','Common-mode choke',[-4.85,.74,-.5],[-3.4,2.1,-.6],'Two windings share a core. Their magnetic fields cancel for differential DC current, while common-mode noise sees a high impedance.','Common-mode attenuation','Ferrite + copper','choke'),
  part('CX1','emi','Input film capacitor A',[-4.85,.73,-1.75],[-3.4,1.5,-1.5],'A film capacitor connected across the DC input helps shunt high-frequency differential noise. Values and ratings require a real EMI and electrical design.','Differential-mode filtering','Metallized film','film'),
  part('CX2','emi','Input film capacitor B',[-4.85,.73,.85],[-3.4,1.6,1.1],'A second input film capacitor is shown as a separate part of the conceptual filter network. This model does not establish emissions compliance.','Differential-mode filtering','Metallized film','film'),
  part('PCB1','structure','Main power PCB',[0,.47,0],[0,.3,0],'Mechanically supports the converter and routes the power, sensing and gate-drive connections. Copper artwork is illustrative; creepage and clearance are not validated.','Interconnection + support','FR-4 + copper','mainboard'),
  part('J1','structure','High-voltage terminal',[-4.55,.64,2.18],[-2.5,1.3,2.1],'The conceptual high-voltage DC interface. In forward operation this is the source-side port; bidirectional control can reverse the power flow.','400 V DC port','Polymer + copper alloy','terminal'),
  part('J2','structure','Low-voltage terminal',[4.75,.64,1.6],[2.7,1.3,1.8],'The conceptual low-voltage DC interface. A 48 V bus at 3 kW would carry 62.5 A at the ideal operating point, so real connections need careful thermal design.','48 V DC port','Polymer + copper alloy','terminal'),
];
export const byId = Object.fromEntries(components.map(p=>[p.id,p]));
export const steps = [
 {name:'Filter & buffer',part:'LCM1',category:'emi',short:'Clean DC in',text:'The input EMI network attenuates conducted switching noise. DC-link capacitors provide a local energy buffer.'},
 {name:'Switch the HV bridge',part:'Q1',category:'semiconductor',short:'DC → high-frequency AC',text:'Four high-voltage SiC MOSFETs form an active full bridge, applying a high-frequency square wave to the magnetic link.'},
 {name:'Transfer & isolate',part:'T1',category:'magnetic',short:'Magnetic energy transfer',text:'The series inductance shapes link current, while the transformer changes the voltage ratio and provides galvanic isolation.'},
 {name:'Switch the LV bridge',part:'Q5',category:'semiconductor',short:'High-frequency AC → DC',text:'A second full bridge uses synchronous MOSFET switching. Phase shift between the bridges controls the direction and amount of transferred power.'},
 {name:'Buffer DC out',part:'C3',category:'capacitor',short:'48 V DC bus',text:'The low-voltage capacitor bank smooths bus ripple. Reverse the relative phase shift and the same architecture transfers energy the other way.'},
];

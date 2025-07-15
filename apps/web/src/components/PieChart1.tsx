"use client"

import { useState } from "react"
import { Pie, PieChart } from "recharts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent } from "@/components/ui/chart"
import { Trash2, Plus } from "lucide-react"

interface ChartSection {
  id: string
  name: string
  value: number
  fill: string
}

export default function EditablePieChart() {
  const [sections, setSections] = useState<ChartSection[]>([
    { id: "1", name: "Marketing", value: 35, fill: "hsl(var(--chart-1))" },
    { id: "2", name: "Development", value: 30, fill: "hsl(var(--chart-2))" },
    { id: "3", name: "Sales", value: 25, fill: "hsl(var(--chart-3))" },
    { id: "4", name: "Support", value: 10, fill: "hsl(var(--chart-4))" },
  ])

  const chartColors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ]

  const totalPercentage = sections.reduce((sum, section) => sum + section.value, 0)

  const addSection = () => {
    const newId = Date.now().toString()
    const colorIndex = sections.length % chartColors.length
    const newSection: ChartSection = {
      id: newId,
      name: `Section ${sections.length + 1}`,
      value: 0,
      fill: chartColors[colorIndex],
    }
    setSections([...sections, newSection])
  }

  const removeSection = (id: string) => {
    setSections(sections.filter((section) => section.id !== id))
  }

  const updateSection = (id: string, field: keyof ChartSection, value: string | number) => {
    setSections(sections.map((section) => (section.id === id ? { ...section, [field]: value } : section)))
  }

  const rebalanceOthers = (keepSectionId: string) => {
    const keepSection = sections.find((s) => s.id === keepSectionId)
    if (!keepSection) return

    const otherSections = sections.filter((s) => s.id !== keepSectionId)
    const otherTotal = otherSections.reduce((sum, section) => sum + section.value, 0)

    if (otherTotal === 0) return // Avoid division by zero

    const remainingPercentage = 100 - keepSection.value

    setSections(
      sections.map((section) => {
        if (section.id === keepSectionId) {
          return section // Keep this section unchanged
        }

        // Calculate proportional percentage for other sections
        const proportion = section.value / otherTotal
        const newValue = Math.round(proportion * remainingPercentage * 100) / 100 // Round to 2 decimal places

        return { ...section, value: newValue }
      }),
    )
  }

  const scaleToHundred = () => {
    if (totalPercentage === 0) return // Avoid division by zero

    const scaleFactor = 100 / totalPercentage

    setSections(
      sections.map((section) => ({
        ...section,
        value: Math.round(section.value * scaleFactor * 100) / 100, // Round to 2 decimal places
      })),
    )
  }

  const chartConfig = sections.reduce(
    (config, section) => {
      config[section.name.toLowerCase().replace(/\s+/g, "")] = {
        label: section.name,
        color: section.fill,
      }
      return config
    },
    {} as Record<string, { label: string; color: string }>,
  )

  return (
    <div className="w-full max-w-4xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Editable Pie Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart */}
            <div className="space-y-4">
              <ChartContainer config={chartConfig} className="aspect-square min-h-[300px]">
                <PieChart>
                  <Pie
                    data={sections}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    strokeWidth={2}
                  />
                  <ChartLegend
                    content={<ChartLegendContent nameKey="name" />}
                    className="flex-wrap gap-2 [&>*]:basis-1/4 [&>*]:justify-center"
                  />
                </PieChart>
              </ChartContainer>

              <div className="text-center space-y-2">
                <p
                  className={`text-sm font-medium ${
                    totalPercentage === 100
                      ? "text-green-600"
                      : totalPercentage > 100
                        ? "text-red-600"
                        : "text-orange-600"
                  }`}
                >
                  Total: {totalPercentage}%
                  {totalPercentage !== 100 && (
                    <span className="ml-2">{totalPercentage > 100 ? "(Over 100%)" : "(Under 100%)"}</span>
                  )}
                </p>

                {totalPercentage < 100 && totalPercentage > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={scaleToHundred}
                    className="text-green-600 hover:text-green-700 bg-transparent"
                  >
                    Scale to 100%
                  </Button>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Chart Sections</h3>
                <Button onClick={addSection} size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Section
                </Button>
              </div>

              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {sections.map((section) => (
                  <Card key={section.id} className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: section.fill }} />
                        <Label htmlFor={`name-${section.id}`} className="text-sm font-medium">
                          Section Name
                        </Label>
                      </div>

                      <Input
                        id={`name-${section.id}`}
                        value={section.name}
                        onChange={(e) => updateSection(section.id, "name", e.target.value)}
                        placeholder="Section name"
                      />

                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label htmlFor={`value-${section.id}`} className="text-sm font-medium">
                            Percentage
                          </Label>
                          <Input
                            id={`value-${section.id}`}
                            type="number"
                            min="0"
                            max="100"
                            value={section.value}
                            onChange={(e) => updateSection(section.id, "value", Number.parseFloat(e.target.value) || 0)}
                            placeholder="0"
                          />
                        </div>

                        <div className="flex items-center gap-1 mt-6">
                          {totalPercentage > 100 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => rebalanceOthers(section.id)}
                              className="text-blue-600 hover:text-blue-700"
                              title={`Keep ${section.name} at ${section.value}% and rebalance others`}
                            >
                              Rebalance
                            </Button>
                          )}

                          {sections.length > 1 && (
                            <Button variant="outline" size="sm" onClick={() => removeSection(section.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {sections.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No sections added yet.</p>
                  <Button onClick={addSection} className="mt-2">
                    <Plus className="w-4 h-4 mr-2" />
                    Add First Section
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

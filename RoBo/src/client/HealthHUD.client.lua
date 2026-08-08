local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Constants = require(ReplicatedStorage.Shared.Constants)
local player = Players.LocalPlayer

local screenGui = Instance.new("ScreenGui")
screenGui.Name = "HealthHUD"
screenGui.ResetOnSpawn = true
screenGui.Parent = player:WaitForChild("PlayerGui")

local frame = Instance.new("Frame")
frame.Name = "HealthBar"
frame.Size = UDim2.new(0, 200, 0, 30)
frame.Position = UDim2.new(0.5, -100, 0, 50)
frame.BackgroundColor3 = Color3.fromRGB(40, 40, 40)
frame.BorderSizePixel = 0
frame.Parent = screenGui

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 6)
corner.Parent = frame

local fill = Instance.new("Frame")
fill.Name = "Fill"
fill.Size = UDim2.new(1, 0, 1, 0)
fill.BackgroundColor3 = Color3.fromRGB(0, 200, 0)
fill.BorderSizePixel = 0
fill.Parent = frame

local fillCorner = Instance.new("UICorner")
fillCorner.CornerRadius = UDim.new(0, 6)
fillCorner.Parent = fill

local label = Instance.new("TextLabel")
label.Name = "Label"
label.Size = UDim2.new(1, 0, 1, 0)
label.BackgroundTransparency = 1
label.Text = ""
label.TextColor3 = Color3.new(1, 1, 1)
label.TextScaled = true
label.Font = Enum.Font.GothamBold
label.ZIndex = 2
label.Parent = frame

local function updateHealth(humanoid: Humanoid)
	local ratio = humanoid.Health / humanoid.MaxHealth
	fill.Size = UDim2.new(math.clamp(ratio, 0, 1), 0, 1, 0)
	label.Text = math.ceil(humanoid.Health) .. " / " .. humanoid.MaxHealth

	if ratio > 0.5 then
		fill.BackgroundColor3 = Color3.fromRGB(0, 200, 0)
	elseif ratio > 0.25 then
		fill.BackgroundColor3 = Color3.fromRGB(230, 200, 0)
	else
		fill.BackgroundColor3 = Color3.fromRGB(200, 0, 0)
	end
end

local function onCharacterAdded(character: Model)
	local humanoid = character:WaitForChild("Humanoid") :: Humanoid
	updateHealth(humanoid)
	humanoid.HealthChanged:Connect(function()
		updateHealth(humanoid)
	end)
end

player.CharacterAdded:Connect(onCharacterAdded)
if player.Character then
	task.spawn(onCharacterAdded, player.Character)
end
